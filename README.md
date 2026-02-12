<div align="center">

> ## ⚠️ IMPORTANT DISCLAIMER
>
> **This project was created purely for fun and educational purposes!**
>
> This is NOT a trading platform. This is NOT financial advice. Please DO NOT attempt to trade or gamble through this application. It's a demonstration of how prediction market APIs can be gamified into an entertaining slot machine experience.
>
> **Use at your own risk. No real money trading. Entertainment only.** 🎰

</div>

---

<div align="center">
  <img
    src="./assets/PolyNanza_banner.png"
    alt="PolyNanza"
    width="846"
    height="236"
  />

# PolyNanza! 🍭
### *Where Candy Meets Crypto Predictions*


[![Made with TypeScript](https://img.shields.io/badge/Made%20with-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.6-F9F1E1?style=for-the-badge&logo=bun&logoColor=black)](https://bun.sh/)
[![Polymarket](https://img.shields.io/badge/Polymarket-API-7B3FE4?style=for-the-badge&logo=ethereum&logoColor=white)](https://polymarket.com/)

[![License: Source Available](https://img.shields.io/badge/License-Source%20Available-orange?style=for-the-badge)](./LICENSE.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen?style=for-the-badge)](https://github.com)

<p align="center">
  <strong>A deliciously addictive slot machine that connects to real Polymarket predictions!</strong>
  <br />
  <em>Educational • Interactive • Sweet</em>
</p>

[🚀 Quick Start](#-quick-start) • [🤝 Contributing](#-contributing)

---

<!-- MAIN SCREENSHOT -->
<img src="./assets/preview_main.png" alt="Polynanza Crush Game Screenshot" width="800"/>

</div>

---

## 🌟 What is PolyNanza?

**PolyNanza** is a candy-themed slot machine that transforms Polymarket prediction markets into a fun, interactive game! Spin adorable gummy bears and candy symbols while real-time market data determines your outcomes.

### 🔌 How It Works

The slot machine connects to Polymarket's API to fetch live prediction market data (BTC price predictions). 

1. **You click SPIN** → The game checks current market prices
2. **Places a bet** → Buys a position at current market price for your bet amount
3. **Waits for Bet Duration** → Holds the position for the configured time period
4. **Sells the position** → Closes the bet and calculates your profit/loss
5. **Animation plays** → Shows your winning (or losing) combination based on the result!

The real market odds influence your slot results, making it more than just random chance - it's tied to actual prediction markets!

```mermaid
sequenceDiagram
    participant User
    participant SlotMachine
    participant GameOrchestrator
    participant PolymarketAPI
    
    User->>SlotMachine: Click SPIN
    SlotMachine->>GameOrchestrator: Request Spin
    GameOrchestrator->>PolymarketAPI: Fetch Market Odds
    PolymarketAPI-->>GameOrchestrator: Return Probabilities
    GameOrchestrator->>GameOrchestrator: Calculate Outcomes
    GameOrchestrator-->>SlotMachine: Return Spin Result
    SlotMachine->>User: Display Animation
```
---

## 📸 Screenshots

<details open>
<summary><b>🎮 Gameplay Gallery</b></summary>

<br/>

### Spin Animation
<img src="./assets/gameplay.webp" alt="gameplay" width="846"/>

### Bet History Tracking
<img src="./assets/bet_history.png" alt="bet_history" width="846"/>

### Settings & Configuration
<div>
  <img src="./assets/settings_main.png" alt="Settings Panel" width="400"/>
  <img src="./assets/settings_polymarket.png" alt="Settings Polymarket" width="400"/>
</div>

</details>

---


## 🚀 Quick Start

### Prerequisites

Make sure you have **Bun** installed:

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash
```

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/polynanza-crush.git
cd polynanza-crush

# 2. Install dependencies
bun install

# 3. Start the development server
bun run dev

------------  OR ------------

./start.sh  # Linux

start.bat   # Windows
```
The app will be available at `http://localhost:3000` 🎉

---

## 🤝 Contributing

Contributions are what make the open source community amazing! 🎉

### How to Contribute

1. **Fork** the project
2. **Create** your feature branch: `git checkout -b feature/AmazingFeature`
3. **Commit** your changes: `git commit -m 'Add some AmazingFeature'`
4. **Push** to the branch: `git push origin feature/AmazingFeature`
5. **Open** a Pull Request

---

## 📜 License

This project is licensed under a **Source-Available (Non-Commercial) License** - see the [LICENSE.md](LICENSE.md) file for details.

### TL;DR:

✅ **You CAN**:
- View and study the code
- Use for personal/educational purposes
- Modify for personal projects

❌ **You CANNOT**:
- Use commercially
- Redistribute or sell
- Deploy publicly for profit


---


<div align="center">

### 📬 Questions? Issues?

[![GitHub Issues](https://img.shields.io/github/issues/yourusername/polynanza-crush?style=for-the-badge)](https://github.com/yourusername/polynanza-crush/issues)
[![GitHub Discussions](https://img.shields.io/github/discussions/yourusername/polynanza-crush?style=for-the-badge)](https://github.com/yourusername/polynanza-crush/discussions)

**Made with ❤️ and 🍭 | 2026**

[⬆ Back to Top](#polynanza-)

</div>