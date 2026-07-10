import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  alignTimeRangeCompareData,
  AnnotationChangeEvent,
  DashboardLoadedEvent,
  DataFrame,
  FieldType,
  PanelProps,
  shouldAlignTimeCompare,
} from '@grafana/data';
import { TooltipDisplayMode, SortOrder } from '@grafana/schema';
import { SimpleOptions } from 'types';
import { css, cx } from '@emotion/css';
import { TimeSeries, useStyles2, TooltipPlugin } from '@grafana/ui';
import { config, PanelDataErrorView, getDataSourceSrv, getAppEvents } from '@grafana/runtime';
import { lastValueFrom, from } from 'rxjs';
import { prepareGraphableFields } from './utils';

interface Props extends PanelProps<SimpleOptions> {}

const getStyles = () => ({
  wrapper: css`
    font-family: Open Sans;
    position: relative;
  `,
  svg: css`
    position: absolute;
    top: 0;
    left: 0;
  `,
  textBox: css`
    position: absolute;
    bottom: 0;
    left: 0;
    padding: 10px;
  `,
});

export const SimplePanel: React.FC<Props> = ({
  options,
  data,
  width,
  height,
  fieldConfig,
  id,
  timeRange,
  eventBus,
}) => {
  const styles = useStyles2(getStyles);
  const [additionalFrames, setAdditionalFrames] = useState<DataFrame[]>([]);
  const urlRef = useRef(options.mountEventUrl);
  urlRef.current = options.mountEventUrl;

  eventBus.subscribe(AnnotationChangeEvent, console.log);

  useEffect(() => {
    return () => {
      const url = urlRef.current;
      if (url) {
        navigator.sendBeacon(
          url,
          JSON.stringify({
            event: 'panel-deleted',
            panelId: id,
            timestamp: Date.now(),
          })
        );
      }
    };
  }, []);

  useEffect(() => {
    if (!options.mountEventUrl) {
      return;
    }
    const sub = getAppEvents().subscribe(DashboardLoadedEvent, (event) => {
      fetch(options.mountEventUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'dashboard-loaded',
          dashboardId: event.payload.dashboardId,
          panelId: id,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    });
    return () => sub.unsubscribe();
  }, [options.mountEventUrl, id]);

  useEffect(() => {
    if (!options.autoOffsetsEnabled) {
      setAdditionalFrames([]);
      return;
    }

    const targets = data.request?.targets;
    if (!targets || targets.length === 0) {
      return;
    }

    const baseTarget = targets.find((t) => t.refId === 'A') ?? targets[0];
    const baseExpr = (baseTarget as unknown as Record<string, unknown>).expr as string | undefined;
    if (!baseExpr) {
      return;
    }

    const offset = options.offsetValue;
    let cancelled = false;

    const run = async () => {
      try {
        const ds = await getDataSourceSrv().get(baseTarget.datasource);
        if (cancelled) {
          return;
        }

        const plusTarget = {
          ...baseTarget,
          refId: 'B',
          expr: `${baseExpr} + ${offset}`,
        };
        const minusTarget = {
          ...baseTarget,
          refId: 'C',
          expr: `${baseExpr} - ${offset}`,
        };

        const response = await lastValueFrom(
          from(
            ds.query({
              ...data.request!,
              targets: [plusTarget, minusTarget],
            })
          )
        );

        if (cancelled || !response.data) {
          return;
        }

        const renamed: DataFrame[] = response.data.map((frame: DataFrame) => {
          const suffix = frame.refId === 'B' ? `+${offset}` : `-${offset}`;
          return {
            ...frame,
            name: frame.name ? `${frame.name} ${suffix}` : suffix,
            fields: frame.fields.map((field: DataFrame['fields'][number]) => {
              if (field.type !== FieldType.time) {
                const baseName = field.config?.displayName || field.name || frame.name || '';
                return {
                  ...field,
                  config: {
                    ...field.config,
                    displayName: baseName ? `${baseName} ${suffix}` : suffix,
                  },
                };
              }
              return field;
            }),
          };
        });

        setAdditionalFrames(renamed);
      } catch {
        if (!cancelled) {
          setAdditionalFrames([]);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [options.autoOffsetsEnabled, options.offsetValue, data.request]);

  const allSeries = useMemo(() => {
    if (additionalFrames.length === 0) {
      return data.series;
    }
    return [...data.series, ...additionalFrames];
  }, [data.series, additionalFrames]);

  const { frames } = useMemo(() => {
    let prepared = prepareGraphableFields(allSeries, config.theme2, timeRange);
    if (prepared) {
      if (options.autoOffsetsEnabled) {
        for (const frame of prepared) {
          if (frame.refId === 'B') {
            for (const field of frame.fields) {
              if (field.type === FieldType.number) {
                field.config = {
                  ...field.config,
                  color: { mode: 'fixed', fixedColor: '#73BF69' },
                };
              }
            }
          } else if (frame.refId === 'C') {
            for (const field of frame.fields) {
              if (field.type === FieldType.number) {
                field.config = {
                  ...field.config,
                  color: { mode: 'fixed', fixedColor: '#F2495C' },
                };
              }
            }
          }
        }
      }
      prepared.forEach((frame: DataFrame) => {
        const diffMs = frame.meta?.timeCompare?.diffMs ?? 0;
        if (diffMs !== 0) {
          const needsAlignment = shouldAlignTimeCompare(frame, prepared, timeRange);
          if (needsAlignment) {
            alignTimeRangeCompareData(frame, diffMs, config.theme2);
          }
        }
      });
      return { frames: prepared };
    }
    return { frames: undefined };
  }, [allSeries, timeRange, options.autoOffsetsEnabled]);

  if (data.series.length === 0 || !frames || frames.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
  }

  const timeSeriesOptions = useMemo(
    () => ({
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true, calcs: [] },
      tooltip: { mode: 'multi', sort: 'none' },
    }),
    []
  );

  return (
    <div
      className={cx(
        styles.wrapper,
        css`
          width: ${width}px;
          height: ${height}px;
        `
      )}
    >
      <TimeSeries
        frames={frames}
        width={width}
        height={height}
        options={timeSeriesOptions}
        timeZone={config.timezone}
        timeRange={timeRange}
        legend={timeSeriesOptions.legend}
      >
        {(builder, alignedFrame) => (
          <TooltipPlugin
            config={builder}
            data={alignedFrame}
            mode={TooltipDisplayMode.Multi}
            sortOrder={SortOrder.None}
            timeZone={config.timezone}
          />
        )}
      </TimeSeries>
    </div>
  );
};
