type SeriesSize = 'sm' | 'md' | 'lg';

export interface SimpleOptions {
  uid: string;
  datasourceType: string;
  text: string;
  showSeriesCount: boolean;
  seriesCountSize: SeriesSize;
  autoOffsetsEnabled: boolean;
  offsetValue: number;
  mountEventUrl: string;
}
