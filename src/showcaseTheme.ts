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
  playerA: 0x4a9eff,
  playerAEmissive: 0x071b35,
  playerAHighlight: 0xc7e2ff,
  playerAHighlightCss: '#c7e2ff',
  playerB: 0xd99a32,
  playerBEmissive: 0x301b05,
  playerBHighlight: 0xffe0a5,
  playerBHighlightCss: '#ffe0a5',
  playerACss: '#4a9eff',
  playerADarkCss: '#1d5da5',
  playerBCss: '#d99a32',
  playerBDarkCss: '#8b5b17'
};

export const ACTIVE_SHOWCASE_THEME = BLUE_YELLOW_THEME;
export const PLAYER_A_COLOR = ACTIVE_SHOWCASE_THEME.playerA;
export const PLAYER_B_COLOR = ACTIVE_SHOWCASE_THEME.playerB;
export const PLAYER_A_LABEL = '蓝方';
export const PLAYER_B_LABEL = '黄方';
