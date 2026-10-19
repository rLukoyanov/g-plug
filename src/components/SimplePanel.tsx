import React, { useEffect, useMemo } from 'react';
import { alignTimeRangeCompareData, DataFrame, FieldType, PanelProps, shouldAlignTimeCompare } from '@grafana/data';
import { LegendDisplayMode, TooltipDisplayMode, SortOrder, VizLegendOptions } from '@grafana/schema';
import { SimpleOptions } from 'types';
import { css, cx } from '@emotion/css';
import { TimeSeries, useStyles2, TooltipPlugin } from '@grafana/ui';
import { config, getDataSourceSrv, PanelDataErrorView } from '@grafana/runtime';
import { prepareGraphableFields } from './utils';

interface Props extends PanelProps<SimpleOptions> {}

const BASELINE_REF_ID = 'BASELINE';
const REF_ID_B = 'B';
const REF_ID_C = 'C';
const COLOR_B = '#73BF69';
const COLOR_C = '#F2495C';

type QueryModel = Record<string, unknown> & { refId?: string };
type QueryTab = {
  onAddQuery: (query: QueryModel) => void;
  getQueries: () => QueryModel[];
  onQueriesChange: (queries: QueryModel[]) => void;
};

const getPrimaryDatasourceType = (datasourceType: string | undefined) => {
  const first = datasourceType?.split(',')[0]?.trim().toLowerCase();
  return first ?? '';
};

const buildBaselineQuery = (datasourceType: string | undefined, uid: string | undefined): QueryModel => {
  const primaryType = getPrimaryDatasourceType(datasourceType);

  if (primaryType.includes('prometheus')) {
    return {
      refId: BASELINE_REF_ID,
      expr: 'up',
      legendFormat: uid ? `uid:${uid}` : undefined,
    };
  }

  if (primaryType.includes('druid')) {
    return {
      refId: BASELINE_REF_ID,
      queryType: 'sql',
      sql: `-- uid: ${uid ?? 'unknown'}\nSELECT\n  TIME_FLOOR(__time, 'PT1M') AS \"time\",\n  COUNT(*) AS \"value\"\nFROM \"${uid ?? 'table_name'}\"\nGROUP BY 1\nORDER BY 1`,
    };
  }

  return { refId: BASELINE_REF_ID };
};

const getQueryTab = (): QueryTab | undefined => {
  const sceneContext = (window as any).__grafanaSceneContext;
  return sceneContext?.state?.editPanel?.state?.dataPane?.state?.tabs?.[0] as QueryTab | undefined;
};

const setLastQueryAsBaseline = (queryTab: QueryTab, datasourceType: string | undefined, uid: string | undefined) => {
  const currentQueries = queryTab.getQueries();
  if (!Array.isArray(currentQueries) || currentQueries.length === 0) {
    return;
  }

  const lastIndex = currentQueries.length - 1;
  const updatedQueries = [...currentQueries];
  const baselineQuery = buildBaselineQuery(datasourceType, uid);

  updatedQueries[lastIndex] = {
    ...updatedQueries[lastIndex],
    ...baselineQuery,
    refId: BASELINE_REF_ID,
  };

  queryTab.onQueriesChange(updatedQueries);
};

const applyAutoOffsetColors = (frames: DataFrame[]) => {
  for (const frame of frames) {
    const color = frame.refId === REF_ID_B ? COLOR_B : frame.refId === REF_ID_C ? COLOR_C : undefined;
    if (!color) {
      continue;
    }

    for (const field of frame.fields) {
      if (field.type === FieldType.number) {
        field.config = {
          ...field.config,
          color: { mode: 'fixed', fixedColor: color },
        };
      }
    }
  }
};

const resolveDatasourceTypes = async (targets: Array<Record<string, any>>) => {
  const found = new Set<string>();

  for (const target of targets) {
    const datasource = target?.datasource;
    if (!datasource) {
      continue;
    }

    if (typeof datasource === 'object' && datasource.type) {
      found.add(datasource.type);
      continue;
    }

    const uid = typeof datasource === 'object' ? datasource.uid : undefined;
    if (!uid) {
      continue;
    }

    try {
      const instance = await getDataSourceSrv().get(uid);
      const type = instance?.meta?.id;
      if (type) {
        found.add(type);
      }
    } catch {
      // Ignore failed datasource resolution and continue with other targets.
    }
  }

  return Array.from(found);
};

const getStyles = () => ({
  wrapper: css`
    font-family: Open Sans;
    position: relative;
  `,
});

export const SimplePanel: React.FC<Props> = ({
  options,
  data,
  width,
  height,
  fieldConfig,
  id,
  onOptionsChange,
  timeZone,
  timeRange,
}) => {
  const styles = useStyles2(getStyles);

  useEffect(() => {
    if (!options.uid) {
      const generatedUid =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `panel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      onOptionsChange({
        ...options,
        uid: generatedUid,
      });
    }
  }, [onOptionsChange, options]);

  useEffect(() => {
    const queryTab = getQueryTab();
    if (!queryTab) {
      return;
    }

    const currentQueries = queryTab.getQueries();
    const hasBaselineQuery = currentQueries.some((query) => query?.refId === BASELINE_REF_ID);

    if (!hasBaselineQuery) {
      queryTab.onAddQuery({});

      // Some query editors ignore incoming refId and assign the next letter (A/B/C),
      // so we patch the last created query back to the desired custom refId.
      setTimeout(() => {
        setLastQueryAsBaseline(queryTab, options.datasourceType, options.uid);
      }, 0);
    }
  }, [data.request, options.datasourceType, options.uid]);

  useEffect(() => {
    let cancelled = false;

    const loadDatasourceTypes = async () => {
      const targets = (data.request?.targets ?? []) as Array<Record<string, any>>;
      const types = await resolveDatasourceTypes(targets);
      const datasourceType = types.length > 0 ? types.join(', ') : 'unknown';

      if (!cancelled && options.datasourceType !== datasourceType) {
        onOptionsChange({
          ...options,
          datasourceType,
        });
      }
    };

    loadDatasourceTypes();

    return () => {
      cancelled = true;
    };
  }, [data.request, onOptionsChange, options]);

  const { frames } = useMemo(() => {
    let prepared = prepareGraphableFields(data.series, config.theme2, timeRange);
    if (prepared) {
      if (options.autoOffsetsEnabled) {
        applyAutoOffsetColors(prepared);
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
  }, [data.series, timeRange, options.autoOffsetsEnabled]);

  const timeSeriesOptions = useMemo(
    () => ({
      tooltip: { mode: 'multi', sort: 'none' },
    }),
    []
  );

  const legendOptions = useMemo<VizLegendOptions>(
    () => ({
      displayMode: LegendDisplayMode.List,
      placement: 'bottom',
      showLegend: true,
      calcs: [],
    }),
    []
  );

  if (data.series.length === 0 || !frames || frames.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
  }

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
        legend={legendOptions}
        options={timeSeriesOptions}
        timeZone={timeZone}
        timeRange={timeRange}
      >
        {(builder, alignedFrame) => (
          <TooltipPlugin
            config={builder}
            data={alignedFrame}
            mode={TooltipDisplayMode.Multi}
            sortOrder={SortOrder.None}
            timeZone={timeZone}
          />
        )}
      </TimeSeries>
    </div>
  );
};
