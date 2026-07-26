import { loadChromaKeyedImage } from "./imageUtils";

export type SceneState = "connecting" | "presentation" | "wait" | "signal" | "acted" | "foul" | "result";

// Translucent tint drawn over the background per state — null means no tint.
const TINT: Record<SceneState, string | null> = {
  connecting: null,
  presentation: null,
  wait: null,
  signal: null, // the shoot icon carries the impact now, no more red flash
  acted: null,
  foul: "rgba(122, 31, 31, 0.55)",
  result: null,
};

const SHOOT_ICON_SCALE = 4;
const SHOOT_ICON_Y_FRAC = 0.55; // centered roughly at the characters' torso height

// Where the two characters stand, as a fraction of canvas size, and how big
// (pixel-art sprites are tiny — scale them up while keeping crisp edges).
const CHAR_SCALE = 3;
const CHAR_LEFT_X_FRAC = 0.28;
const CHAR_RIGHT_X_FRAC = 0.68;
const CHAR_GROUND_Y_FRAC = 0.8;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossible de charger l'image: ${src}`));
    img.src = src;
  });
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLImageElement | null = null;
  private bannerTop: HTMLImageElement | null = null;
  private bannerBottom: HTMLImageElement | null = null;
  private characterLeft: HTMLCanvasElement | null = null;
  private characterRight: HTMLCanvasElement | null = null;
  private shootIcon: HTMLImageElement | null = null;
  bgReady: Promise<void>;

  constructor(
    private canvas: HTMLCanvasElement,
    bgSrc: string,
    bannerTopSrc?: string,
    bannerBottomSrc?: string,
    characterLeftSrc?: string,
    characterRightSrc?: string,
    shootIconSrc?: string
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false; // keep pixel art crisp when scaled up

    const loads: Promise<void>[] = [
      loadImage(bgSrc).then((img) => {
        this.bg = img;
      }),
    ];
    if (bannerTopSrc) {
      loads.push(loadImage(bannerTopSrc).then((img) => (this.bannerTop = img)));
    }
    if (bannerBottomSrc) {
      loads.push(loadImage(bannerBottomSrc).then((img) => (this.bannerBottom = img)));
    }
    if (characterLeftSrc) {
      loads.push(
        loadChromaKeyedImage(characterLeftSrc, [255, 255, 255]).then((c) => (this.characterLeft = c))
      );
    }
    if (characterRightSrc) {
      loads.push(
        loadChromaKeyedImage(characterRightSrc, [255, 255, 255]).then((c) => (this.characterRight = c))
      );
    }
    if (shootIconSrc) {
      loads.push(loadImage(shootIconSrc).then((img) => (this.shootIcon = img)));
    }
    this.bgReady = Promise.all(loads).then(() => undefined);
  }

  // Scales the background to fill the whole canvas without distorting it,
  // cropping whatever overflows — same idea as CSS `background-size: cover`.
  private drawBackgroundCover() {
    if (!this.bg) return;
    const { ctx, canvas, bg } = this;
    const scale = Math.max(canvas.width / bg.width, canvas.height / bg.height);
    const drawW = bg.width * scale;
    const drawH = bg.height * scale;
    const dx = (canvas.width - drawW) / 2;
    const dy = (canvas.height - drawH) / 2;
    ctx.drawImage(bg, dx, dy, drawW, drawH);
  }

  // Stretches a banner to the full canvas width, pinned to the top or bottom
  // edge, preserving its aspect ratio (so it stays a thin horizontal strip).
  private drawBanner(img: HTMLImageElement, edge: "top" | "bottom") {
    const { ctx, canvas } = this;
    const scale = canvas.width / img.width;
    const drawH = img.height * scale;
    const dy = edge === "top" ? 0 : canvas.height - drawH;
    ctx.drawImage(img, 0, dy, canvas.width, drawH);
  }

  // Draws a character standing on the ground line, anchored by its feet
  // (bottom-center) at the given horizontal fraction of the canvas.
  private drawCharacter(sprite: HTMLCanvasElement, xFrac: number) {
    const { ctx, canvas } = this;
    const drawW = sprite.width * CHAR_SCALE;
    const drawH = sprite.height * CHAR_SCALE;
    const cx = canvas.width * xFrac;
    const groundY = canvas.height * CHAR_GROUND_Y_FRAC;
    ctx.drawImage(sprite, cx - drawW / 2, groundY - drawH, drawW, drawH);
  }

  // Draws the shoot cue icon centered on screen, replacing the old red
  // flash + "SHOOT!" text.
  private drawShootIcon() {
    if (!this.shootIcon) return;
    const { ctx, canvas, shootIcon } = this;
    const drawW = shootIcon.width * SHOOT_ICON_SCALE;
    const drawH = shootIcon.height * SHOOT_ICON_SCALE;
    const cx = canvas.width / 2;
    const cy = canvas.height * SHOOT_ICON_Y_FRAC;
    ctx.drawImage(shootIcon, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  }

  draw(state: SceneState, message: string) {
    const { ctx, canvas } = this;

    if (this.bg) {
      this.drawBackgroundCover();
    } else {
      ctx.fillStyle = "#111318"; // fallback while the image is still loading
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Characters stick around from the presentation screen all the way
    // through the duel — only hidden before a match is found.
    if (state !== "connecting") {
      if (this.characterLeft) this.drawCharacter(this.characterLeft, CHAR_LEFT_X_FRAC);
      if (this.characterRight) this.drawCharacter(this.characterRight, CHAR_RIGHT_X_FRAC);
    }

    const tint = TINT[state];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (state === "presentation") {
      if (this.bannerTop) this.drawBanner(this.bannerTop, "top");
      if (this.bannerBottom) this.drawBanner(this.bannerBottom, "bottom");
    }

    if (state === "signal") {
      this.drawShootIcon();
      return; // no text under the icon
    }

    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    ctx.shadowBlur = 0;
  }
}
