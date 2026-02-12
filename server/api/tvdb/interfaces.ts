export interface TvdbLoginResponse {
  data: {
    token: string;
  };
}

export interface TvdbSeriesStatus {
  id: number;
  name: string;
  recordType: string;
  keepUpdated: boolean;
}

export interface TvdbSeriesData {
  id: number;
  name: string;
  status: TvdbSeriesStatus;
  lastAired: string | null;
}

export interface TvdbSeriesResponse {
  data: TvdbSeriesData;
}
