export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access for this site, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. This test needs the front-facing camera.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use. Close other apps using it, then try again.';
    case 'OverconstrainedError':
      return 'The front camera could not be opened with these settings.';
    case 'SecurityError':
      return 'Camera access is blocked. Open this page over HTTPS or localhost.';
    case 'UnsupportedError':
      return 'This browser does not support camera access.';
    case 'RearCameraError':
      return 'Only the front camera is used for this test. The rear camera was not started.';
    default:
      return 'The camera could not be started. Check permission and that no other app is using it.';
  }
}
