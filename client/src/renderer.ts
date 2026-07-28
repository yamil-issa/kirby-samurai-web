import { loadChromaKeyedImage } from "./imageUtils";

export type SceneState = "connecting" | "presentation" | "wait" | "signal" | "acted" | "foul" | "result";

// Who won, from an objective point of view (character1 is always drawn on
// the left, character2 on the right, regardless of which client is viewing).
export type DuelOutcome = "character1" | "character2" | "draw" | null;

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

type Sprite = HTMLCanvasElement | HTMLImageElement;

export type CharacterAssets = {
  idle: string; // opaque white background, gets chroma-keyed
  win?: string; // already has real alpha transparency
  loose?: string; // already has real alpha transparency
};

export type RendererAssets = {
  background: string;
  bannerTop?: string;
  bannerBottom?: string;
  characterLeft: CharacterAssets;
  characterRight: CharacterAssets;
  shootIcon?: string;
};

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
  private leftIdle: HTMLCanvasElement | null = null;
  private leftWin: HTMLImageElement | null = null;
  private leftLoose: HTMLImageElement | null = null;
  private rightIdle: HTMLCanvasElement | null = null;
  private rightWin: HTMLImageElement | null = null;
  private rightLoose: HTMLImageElement | null = null;
  private shootIcon: HTMLImageElement | null = null;
  private leftName = "";
  private rightName = "";
  bgReady: Promise<void>;

  constructor(private canvas: HTMLCanvasElement, assets: RendererAssets) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false; // keep pixel art crisp when scaled up

    const loads: Promise<void>[] = [
      loadImage(assets.background).then((img) => {
        this.bg = img;
      }),
    ];
    if (assets.bannerTop) {
      loads.push(loadImage(assets.bannerTop).then((img) => (this.bannerTop = img)));
    }
    if (assets.bannerBottom) {
      loads.push(loadImage(assets.bannerBottom).then((img) => (this.bannerBottom = img)));
    }
    loads.push(
      loadChromaKeyedImage(assets.characterLeft.idle, [255, 255, 255]).then((c) => (this.leftIdle = c))
    );
    loads.push(
      loadChromaKeyedImage(assets.characterRight.idle, [255, 255, 255]).then((c) => (this.rightIdle = c))
    );
    if (assets.characterLeft.win) {
      loads.push(loadImage(assets.characterLeft.win).then((img) => (this.leftWin = img)));
    }
    if (assets.characterLeft.loose) {
      loads.push(loadImage(assets.characterLeft.loose).then((img) => (this.leftLoose = img)));
    }
    if (assets.characterRight.win) {
      loads.push(loadImage(assets.characterRight.win).then((img) => (this.rightWin = img)));
    }
    if (assets.characterRight.loose) {
      loads.push(loadImage(assets.characterRight.loose).then((img) => (this.rightLoose = img)));
    }
    if (assets.shootIcon) {
      loads.push(loadImage(assets.shootIcon).then((img) => (this.shootIcon = img)));
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
  // (bottom-center) at the given horizontal fraction of the canvas, with
  // its display name in a small label right above its head.
  private drawCharacter(sprite: Sprite, xFrac: number, name: string) {
    const { ctx, canvas } = this;
    const drawW = sprite.width * CHAR_SCALE;
    const drawH = sprite.height * CHAR_SCALE;
    const cx = canvas.width * xFrac;
    const groundY = canvas.height * CHAR_GROUND_Y_FRAC;
    const topY = groundY - drawH;
    ctx.drawImage(sprite, cx - drawW / 2, topY, drawW, drawH);

    if (name) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 4;
      ctx.fillText(name, cx, topY - 6);
      ctx.shadowBlur = 0;
    }
  }

  // Updates the names shown above each character (character1 = left,
  // character2 = right). Call this whenever an S2C_NAMES message arrives.
  setNames(left: string, right: string) {
    this.leftName = left;
    this.rightName = right;
  }

  // Picks idle vs win vs loose for one side, based on the round outcome.
  private pickSprite(side: "left" | "right", state: SceneState, outcome: DuelOutcome): Sprite | null {
    const idle = side === "left" ? this.leftIdle : this.rightIdle;
    if (state !== "result" || !outcome || outcome === "draw") return idle;

    const isThisSideWinner = (side === "left" && outcome === "character1") || (side === "right" && outcome === "character2");
    const win = side === "left" ? this.leftWin : this.rightWin;
    const loose = side === "left" ? this.leftLoose : this.rightLoose;
    return (isThisSideWinner ? win : loose) ?? idle;
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

  draw(state: SceneState, message: string, outcome: DuelOutcome = null) {
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
      const leftSprite = this.pickSprite("left", state, outcome);
      const rightSprite = this.pickSprite("right", state, outcome);
      if (leftSprite) this.drawCharacter(leftSprite, CHAR_LEFT_X_FRAC, this.leftName);
      if (rightSprite) this.drawCharacter(rightSprite, CHAR_RIGHT_X_FRAC, this.rightName);
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
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;

    const maxTextWidth = canvas.width - 60;
    const lines = wrapText(ctx, message, maxTextWidth);
    const lineHeight = 34;
    const messageY = canvas.height * 0.32;
    const startY = messageY - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });
    ctx.shadowBlur = 0;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}
