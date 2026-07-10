import { PanelPlugin } from '@grafana/data';
import { SimpleOptions } from './types';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<SimpleOptions>(SimplePanel).setPanelOptions((builder) => {
  return builder
    .addTextInput({
      path: 'text',
      name: 'Simple text option',
      description: 'Description of panel option',
      defaultValue: 'Default value of text input option',
    })
    .addBooleanSwitch({
      path: 'showSeriesCount',
      name: 'Show series counter',
      defaultValue: false,
    })
    .addRadio({
      path: 'seriesCountSize',
      defaultValue: 'sm',
      name: 'Series counter size',
      settings: {
        options: [
          {
            value: 'sm',
            label: 'Small',
          },
          {
            value: 'md',
            label: 'Medium',
          },
          {
            value: 'lg',
            label: 'Large',
          },
        ],
      },
      showIf: (config) => config.showSeriesCount,
    })
    .addBooleanSwitch({
      path: 'autoOffsetsEnabled',
      name: 'Auto-generate ±offset queries',
      description: 'Automatically creates two additional queries with +N and -N offset',
      defaultValue: false,
    })
    .addNumberInput({
      path: 'offsetValue',
      name: 'Offset value',
      description: 'Value to add/subtract from the base query expression',
      defaultValue: 100,
      showIf: (config) => config.autoOffsetsEnabled,
    })
    .addTextInput({
      path: 'mountEventUrl',
      name: 'Mount event URL',
      description:
        'Send a POST request with panel data when the panel is created. Leave empty to disable.',
      defaultValue: '',
    });
});
