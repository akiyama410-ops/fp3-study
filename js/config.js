// 保管庫（Supabase）の接続先。
// ここに書くのは「公開してよい鍵（publishable key）」だけです。
// secret key / service_role key は絶対に書かないでください。
export const SUPABASE_URL = "https://brmaqtgxtiwsciqdednx.supabase.co";
export const SUPABASE_KEY = "sb_publishable_n5a-P2n-gGXziYzlRxOrvg_E_BXEn-z";

// 無料プランのファイル置き場の上限（バイト）
export const STORAGE_LIMIT = 1024 * 1024 * 1024;
// 1ファイルの上限（バイト）
export const FILE_LIMIT = 50 * 1024 * 1024;

export const FIELDS = [
  { key: "life", name: "ライフプランニング", short: "ライフ", color: "#2f855a" },
  { key: "risk", name: "リスク管理", short: "リスク", color: "#2b6cb0" },
  { key: "kinyu", name: "金融資産運用", short: "金融", color: "#b7791f" },
  { key: "tax", name: "タックスプランニング", short: "タックス", color: "#c53030" },
  { key: "fudosan", name: "不動産", short: "不動産", color: "#6b46c1" },
  { key: "sozoku", name: "相続・事業承継", short: "相続", color: "#2c7a7b" },
];

export const KIND_LABEL = {
  audio: "音声",
  video: "動画",
  slides: "スライド",
  text: "教材",
  quiz: "○×問題",
};
