import type { Game } from './scenes/Game';

type EditorBridgeWindow = Window &
  typeof globalThis & {
    __chipBalance?: (balance: unknown) => void;
    __pendingChipBalance?: number;
    __sugarBlastGameScene?: Game;
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

  if (bridgeWindow.__pendingChipBalance !== undefined) {
    applyBalance(scene, bridgeWindow.__pendingChipBalance);
  }

  scene.events.once('shutdown', () => {
    if (bridgeWindow.__sugarBlastGameScene === scene) {
      delete bridgeWindow.__sugarBlastGameScene;
    }
  });
}
