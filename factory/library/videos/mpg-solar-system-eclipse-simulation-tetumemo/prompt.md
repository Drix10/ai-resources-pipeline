# Solar system orrery that predicts eclipses

- **Source page:** https://motionpromptgallery.com/p/solar-system-eclipse-simulation-tetumemo/
- **Author/creator:** テツメモ｜AI図解×検証｜Newsletter @tetumemo
- **Model:** Claude Fable 5
- **Tools/engine:** React artifact (Claude), requestAnimationFrame
- **Original post:** https://x.com/tetumemo/status/2064477582930989357
- **Posted:** 2026-06-09
- **Site tags:** motion, simulation, physics, canvas
- **Aspect ratio:** 1280/720
- **Provenance note (from the gallery):** Prompt verbatim (Japanese) from the creator's thread: the post says it was built with Claude Fable 5 after a few rounds, and the thread gives the first prompt and this finished prompt. Public artifact: https://claude.ai/public/artifacts/18140288-ab93-4b02-828d-41833e9d0f35. Preview clip and poster from the creator's own video in the X post (re-encoded excerpt). Clip is the first 30 s.

## Prompt (verbatim as published)

````text
物理学の基本原理に基づいて惑星の軌道運動を導き出し、それを用いて日食を予測する
太陽系シミュレーション(オーラリー)をReactのArtifactで作って。

【物理計算の要件】
- 8惑星すべて:J2000元期の軌道要素から、ケプラー方程式(M = E − e·sinE)を
  ニュートン・ラフソン法で毎フレーム解いて位置を計算する(位置のルックアップテーブル禁止)
- 月:平均軌道要素+主要な摂動項(出差・二均差・年差)を加え、
  昇交点の逆行(約19.3°/年)も再現する
- 日食判定:新月(朔)のたびに太陽と月の見かけの離角θを計算し、
  視半径と視差から求めた限界値と比較。黄金分割探索でθの極小値を精密化する
- 日食予測は直近2〜3件をリスト表示する

【画面デザイン】
- 添付画像の雰囲気(ダークな宇宙テーマ、細い軌道線、上品なパネル)を踏襲しつつ、
  UIテキストはすべて日本語にする
- 軌道半径は対数圧縮、天体サイズは誇張表示とし、その旨を画面下部に注記する
- 右側パネル:計算過程(平均近点角→離心近点角→動径、月の黄経・黄緯、日食判定)を
  リアルタイムの数値で表示し、各ステップに初心者向けの短い日本語解説を添える

【操作性】
- 再生/一時停止+再生速度の変更(例:1日/秒〜1ヶ月/秒)
- 日付スライダーまたは日付入力で任意の時点へジャンプ
- マウスホイールでズーム、ドラッグでパン
- 惑星のホバー/クリックで詳細情報(軌道要素・現在の日心距離など)を表示

【技術条件】
- 単一のReactコンポーネント(JSX)で完結させ、外部APIや天文ライブラリは使わない
- アニメーションはrequestAnimationFrameでスムーズに動かす
````

## Code tab (verbatim as published)

````text
First prompt (from the same thread):
https://youtu.be/5f5JYLZHdhw?si=uKs3Ai577zVq3Akj 物理学の基本原理に基づいて惑星の軌道運動を導き出し、それを用いて日食を予測することで、この太陽系のシミュレーションを構築できる？ Artifactで表示させてほしい。

という指示をしようと思っているけど、指示で不足してる部分があればステップバイステップでユーザーに一問一答で確認して

Artifact: https://claude.ai/public/artifacts/18140288-ab93-4b02-828d-41833e9d0f35
````
