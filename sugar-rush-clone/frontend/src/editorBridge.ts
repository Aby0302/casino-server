import type { Game } from './scenes/Game';

type EditorBridgeWindow = Window &
  typeof globalThis & {
    __chipBalance?: (balance: unknown) => void;
    __pendingChipBalance?: number;
    __sugarBlastBootScene?: unknown;
    __sugarBlastGameScene?: Game;
    __sugarBlastStartGame?: () => boolean;
  };

function parseBalance(balance: unknown): number | null {
  const nextBalance = Number(balance);
  return Number.isFinite(nextBalance) ? nextBalance : null;
}

function applyBalance(scene: Game, balance: number): void {
  scene.valueMoney = balance;
  scene.updateMoneyDisplay();
}

export function installEditorBridge(): void {
  const bridgeWindow = window as EditorBridgeWindow;

  bridgeWindow.__chipBalance = (balance: unknown) => {
    const nextBalance = parseBalance(balance);
    if (nextBalance === null) return;

    bridgeWindow.__pendingChipBalance = nextBalance;
    const scene = bridgeWindow.__sugarBlastGameScene;
    if (scene) applyBalance(scene, nextBalance);
  };
}

export function attachEditorBridgeScene(scene: Game): void {
  const bridgeWindow = window as EditorBridgeWindow;

  if (typeof bridgeWindow.__chipBalance !== 'function') installEditorBridge();
  bridgeWindow.__sugarBlastGameScene = scene;
  bridgeWindow.__sugarBlastStartGame = () => true;

  if (bridgeWindow.__pendingChipBalance !== undefined) {
    applyBalance(scene, bridgeWindow.__pendingChipBalance);
  }

  scene.events.once('shutdown', () => {
    if (bridgeWindow.__sugarBlastGameScene === scene) {
      delete bridgeWindow.__sugarBlastGameScene;
    }
  });
}

export function attachEditorBridgeBoot(scene: unknown, startGame: () => void): void {
  const bridgeWindow = window as EditorBridgeWindow;
  bridgeWindow.__sugarBlastBootScene = scene;
  bridgeWindow.__sugarBlastStartGame = () => {
    if (bridgeWindow.__sugarBlastGameScene) return true;
    startGame();
    return true;
  };

  const events = (scene as { events?: { once?: (event: string, cb: () => void) => void } }).events;
  events?.once?.('shutdown', () => {
    if (bridgeWindow.__sugarBlastBootScene === scene) {
      delete bridgeWindow.__sugarBlastBootScene;
      delete bridgeWindow.__sugarBlastStartGame;
    }
  });
}
