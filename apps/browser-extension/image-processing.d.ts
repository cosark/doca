export const MAX_IMAGE_SOURCE_BYTES: number;
export const IMAGE_COMPRESSION_BYTES: number;
export function captureImageInfo(data: Uint8Array): {
  width: number;
  height: number;
  mime: string;
  animated: boolean;
};
export function readCaptureImageResponse(
  response: Response,
): Promise<Uint8Array>;
export function prepareCaptureImage(data: Uint8Array): Promise<Uint8Array>;
