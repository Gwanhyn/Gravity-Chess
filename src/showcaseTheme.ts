export interface PieceTheme {
  name: string;
  playerA: number;
  playerAEmissive: number;
  playerAHighlight: number;
  playerAHighlightCss: string;
  playerB: number;
  playerBEmissive: number;
  playerBHighlight: number;
  playerBHighlightCss: string;
  playerACss: string;
  playerADarkCss: string;
  playerBCss: string;
  playerBDarkCss: string;
}

export const BLUE_YELLOW_THEME: PieceTheme = {
  name: 'blue-yellow',
  playerA: 0x4da3ff,
  playerAEmissive: 0x0b3a66,
  playerAHighlight: 0x9dd8ff,
  playerAHighlightCss: '#9dd8ff',
  playerB: 0xf5b84b,
  playerBEmissive: 0x5a3300,
  playerBHighlight: 0xffe29a,
  playerBHighlightCss: '#ffe29a',
  playerACss: '#4da3ff',
  playerADarkCss: '#1262b3',
  playerBCss: '#f5b84b',
  playerBDarkCss: '#a86810'
};

export const ACTIVE_SHOWCASE_THEME = BLUE_YELLOW_THEME;
export const PLAYER_A_COLOR = ACTIVE_SHOWCASE_THEME.playerA;
export const PLAYER_B_COLOR = ACTIVE_SHOWCASE_THEME.playerB;
export const PLAYER_A_LABEL = '蓝方';
export const PLAYER_B_LABEL = '黄方';
