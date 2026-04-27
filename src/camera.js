/**
 * Camera module — handles webcam access and photo capture.
 */

export class Camera {
  constructor() {
    this.video = document.getElementById('camera-video');
    this.canvas = document.getElementById('camera-canvas');
    this.modal = document.getElementById('camera-modal');
    this.stream = null;
    this.onCapture = null;
  }

  async open() {
    this.modal.classList.remove('hidden');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          facingMode: 'user',
        },
        audio: false,
      });
      this.video.srcObject = this.stream;
    } catch (error) {
      console.error('Camera access failed:', error);
      this.close();
      throw new Error('Could not access camera. Please check permissions.');
    }
  }

  capture() {
    const ctx = this.canvas.getContext('2d');
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;

    // Mirror the capture to match the preview
    ctx.translate(this.canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    return new Promise((resolve) => {
      this.canvas.toBlob((blob) => {
        const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        resolve(file);
      }, 'image/jpeg', 0.92);
    });
  }

  close() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.modal.classList.add('hidden');
  }
}
