// Wraps the two sound effects. Browsers block audio.play() until the page
// has received at least one user gesture (click/keydown) — main.ts makes
// sure a "start" gesture happens before the first connection, which unlocks
// audio for the whole session so these calls succeed afterwards.

export class AudioManager {
  private music: HTMLAudioElement;
  private thud: HTMLAudioElement;

  constructor(musicSrc: string, thudSrc: string) {
    this.music = new Audio(musicSrc);
    this.music.preload = "auto";
    this.thud = new Audio(thudSrc);
    this.thud.preload = "auto";
  }

  playMusic() {
    this.music.currentTime = 0;
    void this.music.play().catch((err) => console.warn("music play failed:", err));
  }

  stopMusic() {
    this.music.pause();
    this.music.currentTime = 0;
  }

  playThud() {
    this.thud.currentTime = 0;
    void this.thud.play().catch((err) => console.warn("thud play failed:", err));
  }
}
