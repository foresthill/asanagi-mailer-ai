"""PoC: cameltech/japanese-gpt-1b-PII-masking をローカル実行して
メール文面での人名・住所マスキングの精度と速度を測る (Issue #45).

実行: uv run --python 3.11 --with torch --with "transformers==4.38.2" \
  --with "tokenizers==0.15.2" --with sentencepiece --with protobuf \
  --with "accelerate==0.27.2" python scripts/pii-ner-poc/poc.py
注意: 顧客の実メールは使わない（合成サンプルのみ — テスト安全規則）。
プロンプト形式はモデルカード準拠（<SEP> / <LB> / beam search）。
"""
import time

from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

MODEL = "cameltech/japanese-gpt-1b-PII-masking"
INSTRUCTION = "# タスク\n入力文中の個人情報をマスキングせよ\n\n# 入力文\n"

# 合成メールサンプル（実在しない人名・住所・電話）
SAMPLES = [
    """田中様

お世話になっております。株式会社ヤマト商事の佐藤健一です。

先日の打ち合わせの件、弊社の鈴木が担当いたします。
資料は東京都港区六本木1-2-3 ヤマトビル5Fへお送りください。

よろしくお願いいたします。""",
    """山田花子様

ご注文ありがとうございます。
お届け先: 大阪府大阪市北区梅田4-5-6 グランドハイツ302号室
お問い合わせは佐々木まで。""",
    """各位

来週の定例会議は6月22日17時からです。
議事録は前回どおり高橋さんが作成します。
場所は本社3階会議室Aです。""",
]


def main() -> None:
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device: {device}")
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(MODEL, use_fast=True)
    model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.float16).to(device)
    print(f"load: {time.time() - t0:.1f}s")

    gen = {
        "max_new_tokens": 512,
        "num_beams": 3,
        "num_return_sequences": 1,
        "early_stopping": True,
        "eos_token_id": tok.eos_token_id,
        "pad_token_id": tok.pad_token_id,
        "repetition_penalty": 3.0,
    }

    for i, text in enumerate(SAMPLES):
        prompt = (INSTRUCTION + text + "<SEP>").replace("\n", "<LB>")
        ids = tok(prompt, return_tensors="pt", add_special_tokens=False).input_ids.to(device)
        t1 = time.time()
        with torch.no_grad():
            out = model.generate(ids, **gen)
        dt = time.time() - t1
        result = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).replace("<LB>", "\n")
        print(f"\n===== sample {i + 1} ({dt:.1f}s, {ids.shape[1]} tok in) =====")
        print(result)


if __name__ == "__main__":
    main()
