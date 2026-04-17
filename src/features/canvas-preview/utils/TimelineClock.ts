/**
 * TimelineClock - Master time authority for the video engine
 *
 * This clock can be driven by either performance.now() OR AudioContext
 * During playback with audio, AudioContext is the authoritative source
 * During scrubbing or silent playback, performance.now() is used
 *
 * CRITICAL: Audio defines time during playback, not RAF!
 */

export class TimelineClock {
  private startTime: number = 0;
  private pausedTime: number = 0;
  private isRunning: boolean = false;
  private audioContext: AudioContext | null = null;
  private audioStartOffset: number = 0; // Offset between audioContext.currentTime and timeline time

  /**
   * Set the audio context for audio-driven playback
   */
  setAudioContext(audioContext: AudioContext | null): void {
    this.audioContext = audioContext;
  }

  /**
   * Start the clock from a specific time
   * If audio context is available, use it as the time source
   */
  start(fromTime: number = 0): void {
    if (this.audioContext) {
      // Audio-driven: store the offset between audio time and timeline time
      this.audioStartOffset = this.audioContext.currentTime - fromTime;
    } else {
      // Performance-driven: use performance.now()
      this.startTime = performance.now() - fromTime * 1000;
    }
    this.pausedTime = 0;
    this.isRunning = true;
  }

  /**
   * Pause the clock and remember current time
   */
  pause(): number {
    if (!this.isRunning) return this.pausedTime;

    this.pausedTime = this.getCurrentTime();
    this.isRunning = false;
    return this.pausedTime;
  }

  /**
   * Resume from paused time
   */
  resume(): void {
    if (this.isRunning) return;

    if (this.audioContext) {
      // Audio-driven: recalculate offset
      this.audioStartOffset = this.audioContext.currentTime - this.pausedTime;
    } else {
      // Performance-driven: recalculate start time
      this.startTime = performance.now() - this.pausedTime * 1000;
    }
    this.isRunning = true;
  }

  /**
   * Seek to a specific time (scrubbing)
   */
  seek(time: number): void {
    this.pausedTime = time;
    if (this.isRunning) {
      if (this.audioContext) {
        this.audioStartOffset = this.audioContext.currentTime - time;
      } else {
        this.startTime = performance.now() - time * 1000;
      }
    }
  }

  /**
   * Get current timeline time
   * Uses AudioContext.currentTime if available (audio-driven)
   * Falls back to performance.now() (performance-driven)
   */
  getCurrentTime(): number {
    if (!this.isRunning) {
      return this.pausedTime;
    }

    // Audio-driven playback (authoritative)
    if (this.audioContext) {
      return this.audioContext.currentTime - this.audioStartOffset;
    }

    // Performance-driven playback (fallback)
    return (performance.now() - this.startTime) / 1000;
  }

  /**
   * Check if clock is running
   */
  isClockRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Reset clock to zero
   */
  reset(): void {
    this.startTime = performance.now();
    this.pausedTime = 0;
    this.isRunning = false;
    this.audioStartOffset = 0;
  }
}
