import { GameConnection } from "./network";
import { Renderer, type DuelOutcome, type SceneState } from "./renderer";
import { AudioManager } from "./audio";
import { setupDiscordSdk, isRunningInsideDiscord, getWebSocketUrl } from "./discord";
import bgUrl from "./assets/background/game-bg.png";
import banner1Url from "./assets/background/character1-pres.png";
import banner2Url from "./assets/background/character2-pres.png";
import char1IdleUrl from "./assets/characters/character1-idle.png";
import char2IdleUrl from "./assets/characters/character2-idle.png";
import char1WinUrl from "./assets/characters/character1-win.png";
import char1LooseUrl from "./assets/characters/character1-lose.png";
import char2WinUrl from "./assets/characters/character2-win.png";
import char2LooseUrl from "./assets/characters/character2-lose.png";
import shootIconUrl from "./assets/effects/shoot.png";
import musicUrl from "./assets/sounds/samurai-kirby.wav";
import thudUrl from "./assets/sounds/thud.wav";

// Set PUBLIC_DISCORD_CLIENT_ID in client/.env.local (see client/.env.example).
// Only needed when actually running inside Discord — local browser testing
// never hits this code path.
const DISCORD_CLIENT_ID = process.env.PUBLIC_DISCORD_CLIENT_ID ?? "";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const status = document.getElementById("status")!;
const postGameActions = document.getElementById("postGameActions")!;
const replayBtn = document.getElementById("replayBtn")!;
const quitBtn = document.getElementById("quitBtn")!;
const renderer = new Renderer(canvas, {
  background: bgUrl,
  bannerTop: banner1Url,
  bannerBottom: banner2Url,
  characterLeft: { idle: char1IdleUrl, win: char1WinUrl, loose: char1LooseUrl },
  characterRight: { idle: char2IdleUrl, win: char2WinUrl, loose: char2LooseUrl },
  shootIcon: shootIconUrl,
});
const audio = new AudioManager(musicUrl, thudUrl);

let canAct = false;
let mySlot: 0 | 1 = 0; // 0 = character1 (left), 1 = character2 (right)
let myDisplayName = "Joueur";

// Tracks the last frame so a "names" update can redraw it without changing
// whatever state/message/outcome was already on screen.
let currentState: SceneState = "connecting";
let currentMessage = "";
let currentOutcome: DuelOutcome = null;
function render(state: SceneState, message: string, outcome: DuelOutcome = null) {
  currentState = state;
  currentMessage = message;
  currentOutcome = outcome;
  renderer.draw(state, message, outcome);
}

renderer.bgReady
  .then(() => {
    render("connecting", "Click or press the Space bar to start");
    waitForStartGesture();
  })
  .catch((err) => console.error(err));

// Browsers block audio.play() until the page has received a real user
function waitForStartGesture() {
  const start = async () => {
    window.removeEventListener("keydown", start);
    canvas.removeEventListener("click", start);

    if (isRunningInsideDiscord()) {
      render("connecting", "Connecting to Discord...");
      try {
        const { displayName } = await setupDiscordSdk(DISCORD_CLIENT_ID);
        myDisplayName = displayName;
      } catch (err) {
        console.error("Discord SDK setup failed:", err);
        render("connecting", "Discord connection error (see the console)");
        return;
      }
    } else {
      // Outside Discord (plain browser testing), give each tab a distinct
      // placeholder name so the labels aren't identical on both sides.
      myDisplayName = `Joueur ${Math.floor(Math.random() * 1000)}`;
    }

    render("connecting", "Connecting...");
    connectToServer();
  };
  window.addEventListener("keydown", start, { once: true });
  canvas.addEventListener("click", start, { once: true });
}

function connectToServer() {
  const conn = new GameConnection(getWebSocketUrl(), (event) => {
    // Whatever just happened, we're not on the post-game screen anymore —
    // the "result" case below is the only one that re-shows the buttons.
    postGameActions.hidden = true;

    switch (event.type) {
      case "matched":
        mySlot = event.slot;
        status.textContent = "Opponent found!";
        render("presentation", "");
        conn.sendName(myDisplayName);
        break;
      case "names":
        renderer.setNames(event.character1, event.character2);
        render(currentState, currentMessage, currentOutcome); // refresh with the new labels
        break;
      case "wait":
        canAct = true;
        status.textContent = "Wait for the signal...";
        render("wait", "Wait...");
        audio.playMusic();
        break;
      case "signal":
        status.textContent = "NOW !";
        render("signal", "SHOOT!");
        audio.stopMusic();
        audio.playThud();
        break;
      case "foul":
        canAct = false;
        status.textContent = "Foul! Too early, the round starts again.";
        render("foul", "Foul!");
        audio.stopMusic();
        break;
      case "opponent_left":
        canAct = false;
        status.textContent = "The opponent has left.";
        audio.stopMusic();
        // The connection stays open
        render("wait", "Opponent has disconnected. Waiting for a new opponent...");
        break;
      case "result": {
        canAct = false;
        const label =
          event.winner === 0
            ? `Win ! (${event.yourReactionMs.toFixed(0)} ms)`
            : event.winner === 1
              ? `Lost... (opponent: ${event.opponentReactionMs.toFixed(0)} ms)`
              : "Draw !";
        status.textContent = label;

        let outcome: DuelOutcome;
        if (event.winner === 2) {
          outcome = "draw";
        } else {
          const iWon = event.winner === 0;
          const iAmCharacter1 = mySlot === 0;
          outcome = iWon === iAmCharacter1 ? "character1" : "character2";
        }

        renderer.flashWhite();
        setTimeout(() => {
          render("result", label, outcome);
          postGameActions.hidden = false;
        }, 130);
        break;
      }
    }
  });

  replayBtn.addEventListener("click", () => {
    postGameActions.hidden = true;
    status.textContent = "Waiting for the opponent...";
    render("wait", "Waiting for the opponent...");
    conn.requestRematch();
  });

  quitBtn.addEventListener("click", () => {
    conn.disconnect();
    window.location.reload();
  });

  function act() {
    if (!canAct) return;
    canAct = false;
    render("acted", "");
    conn.sendAction();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") act();
  });
  canvas.addEventListener("click", act);
}
