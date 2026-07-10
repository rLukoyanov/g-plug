type SeriesSize = 'sm' | 'md' | 'lg';

export interface SimpleOptions {
  text: string;
  showSeriesCount: boolean;
  seriesCountSize: SeriesSize;
  autoOffsetsEnabled: boolean;
  offsetValue: number;
  mountEventUrl: string;
}
