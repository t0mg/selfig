/**
 * Camera module — handles webcam access, photo capture, and camera switching.
 */

export class Camera {
  constructor() {
    this.video = document.getElementById('camera-video');
    this.canvas = document.getElementById('camera-canvas');
    this.modal = document.getElementById('camera-modal');
    this.stream = null;
    this.facingMode = 'user'; // 'user' = front, 'environment' = rear
  }

  async open() {
    this.modal.classList.remove('hidden');
    await this._startStream();
  }

  async _startStream() {
    // Stop any existing stream first
    this._stopTracks();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          facingMode: this.facingMode,
        },
        audio: false,
      });
      this.video.srcObject = this.stream;

      // Mirror only the front camera
      this.video.style.transform = this.facingMode === 'user' ? 'scaleX(-1)' : 'none';
    } catch (error) {
      console.error('Camera access failed:', error);
      this.close();
      throw new Error('Could not access camera. Please check permissions.');
    }
  }

  async switchCamera() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    await this._startStream();
  }

  capture() {
    const ctx = this.canvas.getContext('2d');
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;

    // Mirror the capture only for the front camera (to match the preview)
    if (this.facingMode === 'user') {
      ctx.translate(this.canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    return new Promise((resolve) => {
      this.canvas.toBlob((blob) => {
        const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        resolve(file);
      }, 'image/jpeg', 0.92);
    });
  }

  _stopTracks() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  close() {
    this._stopTracks();
    this.video.srcObject = null;
    this.modal.classList.add('hidden');
  }
}
