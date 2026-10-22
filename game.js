const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const playButton = document.querySelector("#play-button");
const scoreElement = document.querySelector("#score");
const bestScoreElement = document.querySelector("#best-score");
const coinCountElement = document.querySelector("#coin-count");
const leaderboardBody = document.querySelector("#leaderboard-body");
const leaderboardStatus = document.querySelector("#leaderboard-status");
const playerNameInput = document.querySelector("#player-name");
const titleElement = document.querySelector("#overlay-title");
const copyElement = document.querySelector("#overlay-copy");
const emojiElement = document.querySelector("#overlay-emoji");
const buttonLabel = document.querySelector("#button-label");
const speedLabel = document.querySelector(".speed-label");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const GROUND_Y = 257;
const dinosaur = {
  x: 92,
  y: GROUND_Y - 48,
  width: 43,
  height: 48,
  velocityY: 0,
  jumping: false,
};

let obstacles = [];
let coins = [];
let clouds = [];
let particles = [];
let score = 0;
let runCoins = 0;
let bestScore = Number(localStorage.getItem("dino-best-score") || 0);
const storedPlayerName = localStorage.getItem("dino-player-name");
playerNameInput.value = storedPlayerName || window.DINO_CONFIG.playerName || "小恐龍";
let speed = 5.2;
let spawnTimer = 0;
let coinSpawnTimer = 85;
let animationTime = 0;
let animationRequest = 0;
let lastTime = 0;
let state = "ready";
let groundOffset = 0;

bestScoreElement.textContent = formatScore(bestScore);
coinCountElement.textContent = formatScore(runCoins);
void loadLeaderboard();

function getLocalRecords() {
  const records = JSON.parse(localStorage.getItem("dino-game-records") || "[]");
  if (!Array.isArray(records)) {
    throw new Error("本機遊戲紀錄格式錯誤。");
  }
  return records;
}

function isCloudConfigured() {
  return Boolean(window.DINO_CONFIG.supabaseUrl && window.DINO_CONFIG.anonKey);
}

function sortRecords(records) {
  return records.sort((a, b) => b.score - a.score || new Date(a.played_at) - new Date(b.played_at));
}

function renderLeaderboard(records) {
  leaderboardBody.replaceChildren();
  const sortedRecords = sortRecords(records);

  if (sortedRecords.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "leaderboard-empty";
    cell.textContent = "目前還沒有遊玩紀錄，開始遊戲來登上排行榜吧！";
    row.append(cell);
    leaderboardBody.append(row);
    return;
  }

  let previousScore = null;
  let rank = 0;
  sortedRecords.forEach((record, index) => {
    if (record.score !== previousScore) {
      rank = index + 1;
      previousScore = record.score;
    }
    const row = document.createElement("tr");
    const values = [
      { text: `#${rank}`, className: "rank-cell" },
      { text: record.player_name || "小恐龍" },
      { text: formatScore(record.score) },
      { text: String(record.coins) },
      { text: new Date(record.played_at).toLocaleString("zh-TW") },
    ];
    values.forEach(({ text, className }) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (className) cell.className = className;
      row.append(cell);
    });
    leaderboardBody.append(row);
  });
}

function setLeaderboardStatus(message, isError = false) {
  leaderboardStatus.textContent = message;
  leaderboardStatus.classList.toggle("is-error", isError);
}

async function fetchSupabase(path, options = {}) {
  const url = `${window.DINO_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: window.DINO_CONFIG.anonKey,
      Authorization: `Bearer ${window.DINO_CONFIG.anonKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase 回應 ${response.status}: ${details}`);
  }
  return response.status === 204 ? [] : response.json();
}

async function getCloudRecords() {
  const records = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: "id,player_name,score,coins,played_at",
      order: "score.desc,played_at.asc",
      limit: String(pageSize),
      offset: String(offset),
    });
    const page = await fetchSupabase(`game_scores?${query}`);
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

async function loadLeaderboard() {
  const localRecords = getLocalRecords();
  if (!isCloudConfigured()) {
    renderLeaderboard(localRecords);
    setLeaderboardStatus(`本機排行榜 · ${localRecords.length} 筆紀錄；設定 Supabase 後即可跨裝置共用。`);
    return;
  }

  try {
    const cloudRecords = await getCloudRecords();
    const mergedRecords = new Map(localRecords.map((record) => [record.id, record]));
    cloudRecords.forEach((record) => mergedRecords.set(record.id, record));
    const records = [...mergedRecords.values()];
    renderLeaderboard(records);
    setLeaderboardStatus(`雲端排行榜已連線 · ${records.length} 筆紀錄。`);
  } catch (error) {
    console.error("無法載入 Supabase 排行榜。", error);
    renderLeaderboard(localRecords);
    setLeaderboardStatus("雲端排行榜連線失敗；目前顯示此裝置保存的紀錄。", true);
  }
}

async function saveCloudRecord(record) {
  await fetchSupabase("game_scores", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(record),
  });
}

function saveRunRecord() {
  const record = {
    id: createRecordId(),
    player_name: playerNameInput.value.trim().slice(0, 24) || "小恐龍",
    score: Math.floor(score),
    coins: runCoins,
    played_at: new Date().toISOString(),
  };
  const localRecords = getLocalRecords();
  localRecords.push(record);
  localStorage.setItem("dino-game-records", JSON.stringify(localRecords));
  renderLeaderboard(localRecords);

  if (isCloudConfigured()) {
    setLeaderboardStatus("成績已在本機保存，正在同步雲端…");
    saveCloudRecord(record)
      .then(loadLeaderboard)
      .catch((error) => {
        console.error("無法同步成績至 Supabase。", error);
        setLeaderboardStatus("雲端同步失敗；本次成績仍保存在此裝置。", true);
      });
  } else {
    setLeaderboardStatus(`本機排行榜 · 已記錄 ${localRecords.length} 局；設定 Supabase 後即可跨裝置共用。`);
  }
}

function createRecordId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function formatScore(value) {
  return Math.floor(value).toString().padStart(5, "0");
}

playerNameInput.addEventListener("change", () => {
  const playerName = playerNameInput.value.trim().slice(0, 24) || "小恐龍";
  playerNameInput.value = playerName;
  localStorage.setItem("dino-player-name", playerName);
});

function drawDinosaur(x, y, running = false) {
  const legOffset = running ? Math.sin(animationTime / 75) * 4 : 0;
  ctx.fillStyle = "#55765b";

  // Tail, body, neck, head, and snout.
  ctx.fillRect(x + 1, y + 27, 10, 8);
  ctx.fillRect(x + 9, y + 17, 24, 23);
  ctx.fillRect(x + 25, y + 9, 10, 17);
  ctx.fillRect(x + 24, y + 3, 20, 17);
  ctx.fillRect(x + 36, y + 13, 12, 7);
  ctx.fillRect(x + 28, y, 5, 7);

  ctx.fillStyle = "#f8f8ef";
  ctx.fillRect(x + 37, y + 7, 3, 3);

  ctx.fillStyle = "#55765b";
  if (dinosaur.jumping || !running) {
    ctx.fillRect(x + 13, y + 38, 7, 10);
    ctx.fillRect(x + 28, y + 38, 7, 10);
  } else {
    ctx.fillRect(x + 13, y + 37, 7, 8 + legOffset);
    ctx.fillRect(x + 28, y + 37, 7, 8 - legOffset);
  }
}

function drawCloud(cloud) {
  ctx.fillStyle = "rgba(196, 203, 184, 0.44)";
  ctx.beginPath();
  ctx.ellipse(cloud.x, cloud.y, 22, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(cloud.x + 14, cloud.y - 3, 17, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(cloud.x + 28, cloud.y, 21, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCactus(obstacle) {
  const x = obstacle.x;
  const y = GROUND_Y - obstacle.height;
  ctx.fillStyle = "#81966f";
  ctx.fillRect(x + 9, y, 11, obstacle.height);
  ctx.fillRect(x, y + 12, 10, 8);
  ctx.fillRect(x, y + 12, 5, 18);
  ctx.fillRect(x + 20, y + 21, 9, 7);
  ctx.fillRect(x + 24, y + 11, 5, 17);
  ctx.fillRect(x + 5, y + 8, 3, 7);
  ctx.fillRect(x + 19, y + 16, 3, 7);
}

function drawCoin(coin) {
  const bob = Math.sin(animationTime / 180 + coin.phase) * 3;
  const y = coin.y + bob;

  ctx.fillStyle = "rgba(189, 143, 47, 0.18)";
  ctx.beginPath();
  ctx.ellipse(coin.x, y + 2, 12, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d9a83f";
  ctx.beginPath();
  ctx.arc(coin.x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f7d878";
  ctx.beginPath();
  ctx.arc(coin.x - 2, y - 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#bc8528";
  ctx.fillRect(coin.x - 1, y - 4, 2, 8);
}

function drawGround() {
  ctx.strokeStyle = "#aab39e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 0.5);
  ctx.lineTo(WIDTH, GROUND_Y + 0.5);
  ctx.stroke();

  ctx.fillStyle = "#c6cbbb";
  for (let i = 0; i < 15; i += 1) {
    const x = ((i * 83 - groundOffset) % (WIDTH + 20) + WIDTH + 20) % (WIDTH + 20);
    const y = GROUND_Y + 12 + (i % 3) * 9;
    ctx.fillRect(x, y, i % 4 === 0 ? 12 : 5, 2);
  }
}

function drawScene() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  clouds.forEach(drawCloud);
  drawGround();
  obstacles.forEach(drawCactus);
  coins.forEach(drawCoin);
  particles.forEach((particle) => {
    ctx.fillStyle = `rgba(129, 150, 111, ${particle.life / 28})`;
    ctx.fillRect(particle.x, particle.y, 3, 3);
  });

  drawDinosaur(dinosaur.x, dinosaur.y, state === "running");
}

function addCloud() {
  clouds.push({
    x: WIDTH + Math.random() * 70,
    y: 45 + Math.random() * 95,
    speed: 0.45 + Math.random() * 0.45,
  });
}

function spawnObstacle() {
  const height = 31 + Math.random() * 16;
  obstacles.push({ x: WIDTH + 10, width: 29, height });
}

function spawnCoin() {
  const heights = [GROUND_Y - 65, GROUND_Y - 85, GROUND_Y - 103];
  coins.push({
    x: WIDTH + 16,
    y: heights[Math.floor(Math.random() * heights.length)],
    radius: 11,
    phase: Math.random() * Math.PI * 2,
  });
}

function jump() {
  if (state === "ready" || state === "over") {
    startGame();
  }
  if (state === "running" && !dinosaur.jumping) {
    dinosaur.velocityY = -12.6;
    dinosaur.jumping = true;
  }
}

function startGame() {
  score = 0;
  scoreElement.textContent = formatScore(score);
  runCoins = 0;
  coinCountElement.textContent = formatScore(runCoins);
  speed = 5.2;
  spawnTimer = 65;
  coinSpawnTimer = 58 + Math.random() * 35;
  obstacles = [];
  coins = [];
  particles = [];
  dinosaur.y = GROUND_Y - dinosaur.height;
  dinosaur.velocityY = 0;
  dinosaur.jumping = false;
  state = "running";
  overlay.classList.add("is-hidden");
  speedLabel.classList.add("is-running");
  speedLabel.lastChild.textContent = "正在奔跑";
  lastTime = performance.now();
  cancelAnimationFrame(animationRequest);
  animationRequest = requestAnimationFrame(loop);
}

function endGame() {
  state = "over";
  cancelAnimationFrame(animationRequest);
  saveRunRecord();
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem("dino-best-score", String(bestScore));
    bestScoreElement.textContent = formatScore(bestScore);
  }
  titleElement.textContent = "哎呀，撞到了！";
  copyElement.textContent = `這次跑了 ${formatScore(score)} 分，收集 ${runCoins} 枚金幣，再試一次吧。`;
  emojiElement.textContent = "🌵";
  buttonLabel.textContent = "再玩一次";
  overlay.classList.remove("is-hidden");
  speedLabel.classList.remove("is-running");
  speedLabel.lastChild.textContent = "遊戲結束";
  drawScene();
}

function update(delta) {
  const frameScale = Math.min(delta / 16.67, 2.5);
  animationTime += delta;

  if (state === "running") {
    score += delta * 0.006;
    speed = Math.min(5.2 + score * 0.018, 11);
    scoreElement.textContent = formatScore(score);

    dinosaur.velocityY += 0.62 * frameScale;
    dinosaur.y += dinosaur.velocityY * frameScale;
    if (dinosaur.y >= GROUND_Y - dinosaur.height) {
      dinosaur.y = GROUND_Y - dinosaur.height;
      dinosaur.velocityY = 0;
      dinosaur.jumping = false;
    }

    groundOffset = (groundOffset + speed * frameScale) % 83;
    spawnTimer -= frameScale;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = 78 + Math.random() * 54 - Math.min(score * 0.08, 22);
    }
    coinSpawnTimer -= frameScale;
    if (coinSpawnTimer <= 0) {
      spawnCoin();
      coinSpawnTimer = 95 + Math.random() * 55;
    }

    for (const obstacle of obstacles) {
      obstacle.x -= speed * frameScale;
      const hitbox = {
        left: dinosaur.x + 9,
        right: dinosaur.x + dinosaur.width - 3,
        top: dinosaur.y + 8,
        bottom: dinosaur.y + dinosaur.height - 2,
      };
      const cactus = {
        left: obstacle.x + 2,
        right: obstacle.x + obstacle.width - 2,
        top: GROUND_Y - obstacle.height + 2,
        bottom: GROUND_Y,
      };
      if (
        hitbox.left < cactus.right &&
        hitbox.right > cactus.left &&
        hitbox.top < cactus.bottom &&
        hitbox.bottom > cactus.top
      ) {
        endGame();
        return;
      }
    }
    obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -5);

    coins.forEach((coin) => {
      coin.x -= speed * frameScale;
      const bob = Math.sin(animationTime / 180 + coin.phase) * 3;
      const dx = dinosaur.x + dinosaur.width / 2 - coin.x;
      const dy = dinosaur.y + dinosaur.height / 2 - (coin.y + bob);
      if (!coin.collected && Math.hypot(dx, dy) < coin.radius + 20) {
        coin.collected = true;
        runCoins += 1;
        score += 10;
        coinCountElement.textContent = formatScore(runCoins);
        scoreElement.textContent = formatScore(score);
        for (let i = 0; i < 7; i += 1) {
          particles.push({
            x: coin.x + (Math.random() - 0.5) * 18,
            y: coin.y + (Math.random() - 0.5) * 18,
            life: 28,
          });
        }
      }
    });
    coins = coins.filter((coin) => !coin.collected && coin.x + coin.radius > -5);

    clouds.forEach((cloud) => {
      cloud.x -= cloud.speed * frameScale;
    });
    clouds = clouds.filter((cloud) => cloud.x + 50 > 0);
    if (clouds.length < 4 && Math.random() < 0.012 * frameScale) {
      addCloud();
    }

    particles.forEach((particle) => {
      particle.x -= speed * frameScale;
      particle.life -= frameScale;
    });
    particles = particles.filter((particle) => particle.life > 0);
  }
}

function loop(now) {
  const delta = Math.min(now - lastTime, 50);
  lastTime = now;
  update(delta);
  drawScene();

  if (state === "running") {
    animationRequest = requestAnimationFrame(loop);
  }
}

playButton.addEventListener("click", startGame);

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  jump();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" || event.code === "ArrowUp") {
    event.preventDefault();
    if (state !== "running" || !dinosaur.jumping) {
      jump();
    }
  } else if (event.key.toLowerCase() === "r") {
    startGame();
  }
});

drawScene();
