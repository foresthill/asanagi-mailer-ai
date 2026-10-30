# アプリアイコンのソース

朝凪（Asanagi）アプリアイコンの元データ。`src-tauri/icons/` 配下の各サイズ・
`.icns`・`.ico`・Square ロゴは、ここの PNG から `tauri icon` で生成する。

## 採用中
- **波紋（ripple）** = 封筒＋波紋。「便りが届く＝水面に広がる波紋」。
  - 構図: 封筒を中央に置き、その背面から同心円の波紋を半透明で重ねる（並べず「被せる」）。
    波紋は内→外で透明度を上げ、奥行きとして効かせる。小サイズでは封筒だけが残り可読。
  - ベクタ: `ripple.svg` / ラスタ: `ripple-1024.png`

## 控え（すぐ差し替え可）
- **朝日（dawn）** = 封筒＋朝日。朝凪の情緒を一番残す案。
  - ベクタ: `dawn.svg` / ラスタ: `dawn-1024.png`

配色: 背景 `#0E4F5C`（朝凪テーマのエメラルドブルー）/ 波紋 `#5FD0C2` /
封筒・輪郭 `#EAF6F2` / 朝日 `#FFCE93`。

## 作り直し・差し替え手順

SVG を編集したら 1024px PNG に書き出してから `tauri icon` に渡す。

```bash
# 1) SVG → 1024 PNG（透過背景）
node -e "const s=require('sharp'),f=require('fs');s(f.readFileSync('src-tauri/icons/source/ripple.svg'),{density:384}).resize(1024,1024,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile('src-tauri/icons/source/ripple-1024.png').then(i=>console.log(i.width+'x'+i.height))"

# 2) 全サイズ・.icns・.ico・Square ロゴを生成（src-tauri/icons/ に出力）
npx tauri icon src-tauri/icons/source/ripple-1024.png

# 3) 不要な net-new（デスクトップ外）は捨てる
rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png
```

朝日案に切り替えるときは 2) の入力を `dawn-1024.png` にするだけ。

## 改名の候補（保留中・現名は Asanagi のまま）

将来の表示名リブランド用のメモ。識別子（bundle id / リポジトリ）は変えず、
表示名（productName・ウィンドウ名・UI の「朝凪」表記・README）だけ差し替える想定。
決定時は アニメ/アプリ/ドメイン/商標 の衝突を確認してから採用する。

| 候補 | 読み | 由来・ニュアンス | 波紋アイコンとの相性 |
|------|------|------------------|----------------------|
| 細波 | Sazanami | さざ波。水面に立つ細かな波＝便りの広がり | ◎（波紋と直結） |
| 澪   | Mio   | 水脈・舟の通った跡。静かな導線 | ◎（水の世界観） |
| 栞   | Shiori | しおり。読みかけに寄り添う小さな道標 | ○ |
| 和み | Nagomi | なごみ。穏やかさ | ○ |
| 木漏れ日 | Komorebi | 葉間から差す光。やわらかな情緒 | △（水より光寄り） |

現在の内部名/表示名は **Asanagi（朝凪）** のまま。上記は確定ではなく案の記録。
