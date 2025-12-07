export interface AudioBlob {
  data: string;
  mimeType: string;
}

export enum CallStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
  ENDED = 'ENDED'
}
