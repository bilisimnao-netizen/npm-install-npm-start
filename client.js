const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const minimap = document.getElementById("minimapCanvas");
const miniCtx = minimap.getContext("2d");

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const deathOverlay = document.getElementById("deathOverlay");

let myId = null;
let MAP_SIZE = 9000;
let selectedChar = "recep";
let gameStarted = false;
let playerDied = false;
let hudTick = 0;
let minimapTick = 0;

let STATIC_WORLD = {
    envs: {},
    goldVeins: {}
};

let SERVER_STATE = {
    players: {},
    units: {},
    foods: {},
    buildings: {},
    projectiles: {},
    clans: {}
};

let RENDER_STATE = {
    players: {},
    units: {}
};

let camera = {
    x: 0,
    y: 0,
    zoom: 0.92,
    targetZoom: 0.92
};

let mouse = {
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0
};

let screenShake = { power: 0 };

let activeMode = null; // house, tower, mine, magetower, sell

const COSTS = {
    house: 250,
    tower: 250,
    mine: 500,
    magetower: 1500,
    soldier: 15,
    knight: 75,
    archer: 125,
    mage: 350,
    dragon: 450
};

const TYPE_EMOJI = {
    recep: "🧔",
    togg: "🚗",
    bez: "🧽",
    soldier: "⭐",
    knight: "🛡️",
    archer: "🏹",
    mage: "🧙",
    dragon: "🐲",
    house: "⛺",
    tower: "🗼",
    mine: "⛏️",
    magetower: "🔮"
};

const particles = [];
const floatTexts = [];
const trails = [];
const rings = [];
const flashes = [];

const IMAGES = {};
const imageFiles = {
    bg: "bg.png",
    recep: "recep.png",
    togg: "togg.png",
    bez: "bez.png",
    house: "house.png",
    tower: "tower.png",
    mine: "mine.png",
    magetower: "magetower.png",
    soldier: "soldier.png",
    knight: "knight.png",
    archer: "archer.png",
    mage: "mage.png",
    dragon: "dragon.png",
    vein: "vein.png",
    tree: "tree.png",
    rock: "rock.png"
};

for (const key in imageFiles) {
    const img = new Image();
    img.src = imageFiles[key];
    IMAGES[key] = img;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    minimap.width = 250;
    minimap.height = 250;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

window.selectChar = function selectChar(type, el) {
    selectedChar = type;
    document.querySelectorAll(".char-box").forEach(box => box.classList.remove("active"));
    el.classList.add("active");
};

function setMode(mode) {
    activeMode = mode;
    document.querySelectorAll(".action-slot").forEach(slot => slot.classList.remove("selected"));

    if (mode && document.getElementById("btn_" + mode)) {
        document.getElementById("btn_" + mode).classList.add("selected");
    }

    if (mode === "sell") {
        window.showSystemAlert("Satış modu aktif. Kendi yapına tıkla.");
    } else if (mode) {
        window.showSystemAlert("Yerleştirme modu aktif. Haritada bir yere tıkla.");
    }
}

document.getElementById("playBtn").addEventListener("click", () => {
    const clan = document.getElementById("clanName").value.trim();
    const name = document.getElementById("playerName").value.trim() || "İsimsiz Lord";

    document.getElementById("lobby").style.display = "none";
    document.getElementById("uiLayer").style.display = "block";
    canvas.style.display = "block";

    socket.emit("joinGame", {
        name,
        clan,
        charType: selectedChar
    });
});

document.getElementById("restartBtn").addEventListener("click", () => {
    window.location.reload();
});

document.getElementById("btn_house").addEventListener("click", () => setMode("house"));
document.getElementById("btn_tower").addEventListener("click", () => setMode("tower"));
document.getElementById("btn_mine").addEventListener("click", () => setMode("mine"));
document.getElementById("btn_magetower").addEventListener("click", () => setMode("magetower"));
document.getElementById("btn_sell").addEventListener("click", () => setMode("sell"));

document.getElementById("btn_soldier").addEventListener("click", () => socket.emit("buyUnit", "soldier"));
document.getElementById("btn_knight").addEventListener("click", () => socket.emit("buyUnit", "knight"));
document.getElementById("btn_archer").addEventListener("click", () => socket.emit("buyUnit", "archer"));
document.getElementById("btn_mage").addEventListener("click", () => socket.emit("buyUnit", "mage"));
document.getElementById("btn_dragon").addEventListener("click", () => socket.emit("buyUnit", "dragon"));

document.getElementById("clanJoinBtn").addEventListener("click", () => {
    const tag = document.getElementById("clanTagInput").value.trim();
    socket.emit("joinClan", { tag });
});

document.getElementById("clanLeaveBtn").addEventListener("click", () => {
    socket.emit("leaveClan");
});

window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.worldX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
    mouse.worldY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
});

window.addEventListener("wheel", (e) => {
    if (!gameStarted || playerDied) return;
    const delta = Math.sign(e.deltaY) * 0.05;
    camera.targetZoom = clamp(camera.targetZoom - delta, 0.68, 1.12);
}, { passive: true });

window.addEventListener("keydown", (e) => {
    if (document.activeElement === chatInput) return;

    const key = e.key.toLowerCase();

    if (key === "c") setMode("house");
    if (key === "e") setMode("tower");
    if (key === "r") setMode("mine");
    if (key === "f") setMode("magetower");
    if (key === "x") setMode("sell");

    if (key === "t") socket.emit("buyUnit", "soldier");
    if (key === "y") socket.emit("buyUnit", "knight");
    if (key === "u") socket.emit("buyUnit", "archer");
    if (key === "i") socket.emit("buyUnit", "mage");
    if (key === "m") socket.emit("buyUnit", "dragon");

    if (key === "escape") setMode(null);
});

canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    setMode(null);
});

canvas.addEventListener("mousedown", (e) => {
    if (!gameStarted || playerDied) return;

    if (e.button !== 0) return;

    if (activeMode === "sell") {
        socket.emit("sellAt", { x: mouse.worldX, y: mouse.worldY });
        return;
    }

    if (["house", "tower", "mine", "magetower"].includes(activeMode)) {
        socket.emit("placeBuilding", {
            type: activeMode,
            x: mouse.worldX,
            y: mouse.worldY
        });
        return;
    }
});

setInterval(() => {
    if (myId && SERVER_STATE.players[myId] && !playerDied) {
        socket.emit("mouseUpdate", { x: mouse.worldX, y: mouse.worldY });
    }
}, 40);

socket.on("init", (data) => {
    myId = data.id;
    MAP_SIZE = data.staticWorld.mapSize;
    STATIC_WORLD.envs = data.staticWorld.envs || {};
    STATIC_WORLD.goldVeins = data.staticWorld.goldVeins || {};
    SERVER_STATE = data.state;
    gameStarted = true;
    playerDied = false;
    deathOverlay.style.display = "none";

    for (const id in SERVER_STATE.players) {
        RENDER_STATE.players[id] = { x: SERVER_STATE.players[id].x, y: SERVER_STATE.players[id].y };
    }
    for (const id in SERVER_STATE.units) {
        RENDER_STATE.units[id] = { x: SERVER_STATE.units[id].x, y: SERVER_STATE.units[id].y };
    }

    updateHUD();
    requestAnimationFrame(gameLoop);
});

socket.on("stateUpdate", (data) => {
    const oldState = SERVER_STATE;
    SERVER_STATE = data.state;

    for (const id in SERVER_STATE.players) {
        if (!RENDER_STATE.players[id]) {
            RENDER_STATE.players[id] = { x: SERVER_STATE.players[id].x, y: SERVER_STATE.players[id].y };
            spawnParticles(SERVER_STATE.players[id].x, SERVER_STATE.players[id].y, "#74b9ff", 6, 2.5);
        }
    }

    for (const id in SERVER_STATE.units) {
        if (!RENDER_STATE.units[id]) {
            RENDER_STATE.units[id] = { x: SERVER_STATE.units[id].x, y: SERVER_STATE.units[id].y };
        }
    }

    for (const id in RENDER_STATE.players) {
        if (!SERVER_STATE.players[id]) delete RENDER_STATE.players[id];
    }

    for (const id in RENDER_STATE.units) {
        if (!SERVER_STATE.units[id]) delete RENDER_STATE.units[id];
    }

    detectDamage(oldState, SERVER_STATE);

    if (myId && !SERVER_STATE.players[myId] && gameStarted && !playerDied) {
        playerDied = true;
        deathOverlay.style.display = "flex";
        screenShake.power = 8;
        spawnExplosion(camera.x, camera.y, "#ff6b6b", 24);
    }

    hudTick += 1;
    if (hudTick % 2 === 0) updateHUD();
});

socket.on("clanState", (data) => {
    renderClanPanel(data);
});

socket.on("chatMsg", (data) => {
    appendChatMessage(data.sender, data.msg, data.color || "#ffffff");

    if (data.isKillFeed && typeof window.pushKillFeed === "function") {
        window.pushKillFeed(data.msg);
    }
});

socket.on("systemAlert", (msg) => {
    window.showSystemAlert(msg);
});

socket.on("actionSuccess", (payload) => {
    const me = SERVER_STATE.players[myId];
    if (!me) return;

    if (payload.type === "build") {
        spawnParticles(mouse.worldX, mouse.worldY, "#ffd85a", 10, 2.5);
        spawnPulseRing(mouse.worldX, mouse.worldY, "rgba(255,216,90,0.7)", 16, 90);
    }

    if (payload.type === "spawn") {
        spawnFlash(me.x, me.y, "rgba(255,255,255,0.6)", 22);
    }
});

function renderClanPanel(data) {
    const current = document.getElementById("currentClan");
    const members = document.getElementById("clanMembers");
    current.textContent = data.myClan ? `[${data.myClan}]` : "Yok";

    let html = "";
    if (data.myClan && data.clans[data.myClan]) {
        for (const m of data.clans[data.myClan].members) {
            html += `<div class="member-row">${escapeHtml(m.name)}</div>`;
        }
    } else {
        html = `<div class="member-row muted">Klanda değilsin</div>`;
    }
    members.innerHTML = html;
}

chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        const text = chatInput.value.trim();
        if (text) socket.emit("sendChat", text);
        chatInput.value = "";
    }
});

function appendChatMessage(sender, msg, color) {
    const div = document.createElement("div");
    div.style.marginBottom = "6px";
    div.innerHTML = `<strong style="color:${color}">${escapeHtml(sender)}:</strong> ${escapeHtml(msg)}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function detectDamage(oldState, newState) {
    const groups = ["players", "units", "buildings"];

    for (const key of groups) {
        const oldObj = oldState[key] || {};
        const newObj = newState[key] || {};

        for (const id in newObj) {
            const prev = oldObj[id];
            const curr = newObj[id];
            if (!prev || !curr) continue;
            if (typeof prev.hp !== "number" || typeof curr.hp !== "number") continue;

            const delta = prev.hp - curr.hp;
            if (delta > 0) {
                spawnParticles(curr.x, curr.y, "#ff8e8e", Math.min(6, 2 + Math.floor(delta / 18)), 2.0);
                spawnFlash(curr.x, curr.y, "rgba(255,255,255,0.35)", 12);
                screenShake.power = Math.max(screenShake.power, Math.min(4, 0.5 + delta * 0.02));
            }
        }
    }
}

function spawnParticles(x, y, color, count = 6, speed = 2.4) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * speed * 2,
            vy: (Math.random() - 0.5) * speed * 2,
            life: 14 + Math.random() * 10,
            maxLife: 14 + Math.random() * 10,
            size: 2 + Math.random() * 2.5,
            color
        });
    }
}

function spawnExplosion(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            life: 22 + Math.random() * 10,
            maxLife: 22 + Math.random() * 10,
            size: 3 + Math.random() * 4,
            color
        });
    }
}

function spawnTrail(x, y, color, size = 8) {
    if (Math.random() > 0.35) return;
    trails.push({
        x,
        y,
        size,
        alpha: 0.22,
        color
    });
}

function spawnPulseRing(x, y, color, start = 8, max = 60) {
    rings.push({
        x,
        y,
        radius: start,
        maxRadius: max,
        alpha: 0.7,
        color,
        width: 3
    });
}

function spawnFlash(x, y, color, size = 18) {
    flashes.push({
        x,
        y,
        size,
        alpha: 0.45,
        color
    });
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function getDist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function isImageReady(key) {
    return IMAGES[key] && IMAGES[key].complete && IMAGES[key].naturalWidth > 0;
}

function drawGround() {
    ctx.fillStyle = "#2b6b3c";
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.016)";
    for (let i = 0; i < MAP_SIZE; i += 140) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, MAP_SIZE);
        ctx.moveTo(0, i);
        ctx.lineTo(MAP_SIZE, i);
    }
    ctx.stroke();
}

function drawMapBorder() {
    ctx.lineWidth = 16;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
}

function drawShadow(x, y, radius, alpha = 0.2) {
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.82, radius * 0.9, radius * 0.38, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fill();
}

function drawSelectionRing(x, y, radius, color) {
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.28, radius * 0.95, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.stroke();
}

function drawHP(x, y, hp, maxHp, radius) {
    const width = radius * 2.2;
    const yOffset = radius + 22;
    const ratio = clamp(hp / maxHp, 0, 1);

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x - width / 2, y - yOffset, width, 7);

    ctx.fillStyle = ratio > 0.65 ? "#2ecc71" : ratio > 0.35 ? "#f1c40f" : "#e74c3c";
    ctx.fillRect(x - width / 2, y - yOffset, width * ratio, 7);
}

function drawNameTag(x, y, text, color = "#ffffff") {
    ctx.font = "bold 14px Ubuntu";
    ctx.textAlign = "center";
    const w = ctx.measureText(text).width + 18;

    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(x - w / 2, y - 60, w, 20);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y - 46);
}

function drawFood(food) {
    const r = food.val > 10 ? 8 : 4.5;
    ctx.beginPath();
    ctx.arc(food.x, food.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#f1c40f";
    ctx.fill();
}

function drawGoldVein(vein) {
    if (isImageReady("vein")) {
        ctx.drawImage(IMAGES.vein, vein.x - vein.radius, vein.y - vein.radius, vein.radius * 2, vein.radius * 2);
        return;
    }

    ctx.beginPath();
    ctx.arc(vein.x, vein.y, vein.radius, 0, Math.PI * 2);
    ctx.fillStyle = vein.isOccupied ? "rgba(120,120,120,0.08)" : "rgba(241,196,15,0.12)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = vein.isOccupied ? "rgba(170,170,170,0.35)" : "rgba(241,196,15,0.55)";
    ctx.stroke();
}

function drawEnv(env, me) {
    if (!me) return;
    const distToMe = getDist(me.x, me.y, env.x, env.y);
    ctx.globalAlpha = distToMe < env.radius + 20 ? 0.42 : 1;

    if (isImageReady(env.type)) {
        ctx.drawImage(IMAGES[env.type], env.x - env.radius, env.y - env.radius, env.radius * 2, env.radius * 2);
    } else {
        ctx.beginPath();
        ctx.arc(env.x, env.y, env.radius, 0, Math.PI * 2);
        ctx.fillStyle = env.type === "tree" ? "#2d6a4f" : "#6c757d";
        ctx.fill();
    }

    ctx.globalAlpha = 1;
}

function drawBuilding(b, meServer) {
    const isMine = b.ownerId === myId;
    const isClan = meServer?.clan && b.clan && meServer.clan === b.clan;
    const radius = (b.type === "mine") ? 54 : 46;
    const size = (b.type === "mine") ? 132 : 98;
    const ringColor = isMine ? "rgba(93,173,226,0.55)" : isClan ? "rgba(180,120,255,0.55)" : "rgba(231,76,60,0.45)";

    drawShadow(b.x, b.y, radius, 0.22);

    if (isImageReady(b.type)) {
        ctx.drawImage(IMAGES[b.type], b.x - size / 2, b.y - size / 2, size, size);
    } else {
        ctx.fillStyle = isMine ? "#3498db" : isClan ? "#9b59b6" : "#e74c3c";
        ctx.beginPath();
        ctx.arc(b.x, b.y, radius - 6, 0, Math.PI * 2);
        ctx.fill();
    }

    drawSelectionRing(b.x, b.y, radius, ringColor);
    drawHP(b.x, b.y, b.hp, b.maxHp, radius);
}

function drawProjectile(prj) {
    ctx.save();

    if (prj.type === "arrow") {
        const angle = Math.atan2((prj.targetY || prj.y) - prj.y, (prj.targetX || prj.x) - prj.x);
        ctx.translate(prj.x, prj.y);
        ctx.rotate(angle);

        ctx.fillStyle = "#8b5a2b";
        ctx.fillRect(-9, -2, 18, 4);

        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(4, -4);
        ctx.lineTo(4, 4);
        ctx.closePath();
        ctx.fillStyle = "#e8e8e8";
        ctx.fill();
    } else if (prj.type === "magic") {
        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#9b59b6";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(200,150,255,0.45)";
        ctx.stroke();
    } else if (prj.type === "fireball") {
        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = "#ff7a18";
        ctx.fill();
    }
    ctx.restore();
}

function drawUnit(uS, uR, meServer) {
    const radius = uS.type === "dragon" ? 34 : uS.type === "knight" ? 22 : 18;
    const isMine = uS.ownerId === myId;
    const isClan = meServer?.clan && uS.clan && meServer.clan === uS.clan;
    const ringColor = isMine ? "rgba(93,173,226,0.55)" : isClan ? "rgba(180,120,255,0.55)" : "rgba(231,76,60,0.45)";
    const bodyColor = isMine ? "#5dade2" : isClan ? "#af7ac5" : "#ec7063";

    if (uS.type === "dragon") spawnTrail(uR.x, uR.y, "rgba(255,120,60,0.5)", 10);

    drawShadow(uR.x, uR.y, radius, 0.18);

    if (isImageReady(uS.type)) {
        ctx.drawImage(IMAGES[uS.type], uR.x - radius * 1.5, uR.y - radius * 1.5, radius * 3, radius * 3);
    } else {
        ctx.beginPath();
        ctx.arc(uR.x, uR.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `${uS.type === "dragon" ? 22 : 16}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText(TYPE_EMOJI[uS.type] || "•", uR.x, uR.y + 5);
    }

    drawSelectionRing(uR.x, uR.y, radius, ringColor);
    drawHP(uR.x, uR.y, uS.hp, uS.maxHp, radius);
}

function drawPlayer(pS, pR, meServer) {
    const isMine = pS.id === myId;
    const isClan = meServer?.clan && pS.clan && meServer.clan === pS.clan;
    const ringColor = isMine ? "rgba(46,204,113,0.65)" : isClan ? "rgba(180,120,255,0.6)" : "rgba(231,76,60,0.45)";
    const radius = pS.radius || 40;

    drawShadow(pR.x, pR.y, radius + 4, 0.24);

    if (isImageReady(pS.charType)) {
        ctx.drawImage(IMAGES[pS.charType], pR.x - radius * 1.45, pR.y - radius * 1.45, radius * 2.9, radius * 2.9);
    } else {
        ctx.beginPath();
        ctx.arc(pR.x, pR.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isMine ? "#27ae60" : isClan ? "#8e44ad" : "#c0392b";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "34px Arial";
        ctx.textAlign = "center";
        ctx.fillText(TYPE_EMOJI[pS.charType] || "👑", pR.x, pR.y + 10);
    }

    drawSelectionRing(pR.x, pR.y, radius, ringColor);
    drawHP(pR.x, pR.y, pS.hp, pS.maxHp, radius);

    const clanTag = pS.clan ? `[${pS.clan}] ` : "";
    drawNameTag(pR.x, pR.y, `${clanTag}${pS.name}`, isMine ? "#9cffbf" : isClan ? "#e7c8ff" : "#ffffff");
}

function drawPlacementPreview(me) {
    if (!activeMode || !me) return;
    if (!["house", "tower", "mine", "magetower", "sell"].includes(activeMode)) return;

    if (activeMode === "sell") {
        ctx.beginPath();
        ctx.arc(mouse.worldX, mouse.worldY, 24, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(231,76,60,0.7)";
        ctx.lineWidth = 3;
        ctx.stroke();
        return;
    }

    const maxRange = 340;
    ctx.beginPath();
    ctx.arc(me.x, me.y, maxRange, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const color = getDist(me.x, me.y, mouse.worldX, mouse.worldY) <= maxRange
        ? "rgba(46,204,113,0.6)"
        : "rgba(231,76,60,0.6)";

    ctx.beginPath();
    ctx.arc(mouse.worldX, mouse.worldY, 32, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
}

function drawTrails() {
    for (let i = trails.length - 1; i >= 0; i--) {
        const t = trails[i];
        t.alpha -= 0.03;
        t.size *= 0.98;
        if (t.alpha <= 0.02 || t.size < 1) {
            trails.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = t.alpha;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawRings() {
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.radius += 2.2;
        r.alpha -= 0.045;
        if (r.alpha <= 0.02 || r.radius >= r.maxRadius) {
            rings.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = r.alpha;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

function drawFlashes() {
    for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.alpha -= 0.08;
        f.size *= 1.06;

        if (f.alpha <= 0.02) {
            flashes.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.life -= 1;

        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = p.life / p.maxLife;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawFloatTexts() {
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const t = floatTexts[i];
        t.y += t.vy;
        t.alpha -= 0.03;

        if (t.alpha <= 0) {
            floatTexts.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = t.alpha;
        ctx.font = "bold 15px Ubuntu";
        ctx.textAlign = "center";
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.globalAlpha = 1;
    }
}

function updateHUD() {
    const me = SERVER_STATE.players[myId];
    if (!me) return;

    document.getElementById("goldVal").textContent = Math.floor(me.gold);
    document.getElementById("armyVal").textContent = me.population;
    document.getElementById("popVal").textContent = me.maxPop;
    document.getElementById("scoreVal").textContent = Math.floor(me.score);

    for (const key in COSTS) {
        const btn = document.getElementById("btn_" + key);
        if (!btn) continue;

        const isUnit = ["soldier", "knight", "archer", "mage", "dragon"].includes(key);
        const canBuy = isUnit
            ? me.gold >= COSTS[key] && me.population < me.maxPop
            : me.gold >= COSTS[key];

        if (canBuy) btn.classList.remove("disabled");
        else btn.classList.add("disabled");
    }

    const arr = Object.values(SERVER_STATE.players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    let html = "";
    arr.forEach((p, i) => {
        const clanTag = p.clan ? `<span style="color:#ffd85a">[${escapeHtml(p.clan)}]</span> ` : "";
        const rowStyle = p.id === myId ? `style="color:#7dffb3"` : "";
        html += `<li ${rowStyle}><span>${i + 1}. ${clanTag}${escapeHtml(p.name)}</span><span>${Math.floor(p.score)}</span></li>`;
    });

    document.getElementById("leaderList").innerHTML = html;
}

function drawMinimap(meServer) {
    miniCtx.clearRect(0, 0, minimap.width, minimap.height);
    miniCtx.fillStyle = "#132126";
    miniCtx.fillRect(0, 0, minimap.width, minimap.height);

    const scale = minimap.width / MAP_SIZE;

    for (const id in STATIC_WORLD.goldVeins) {
        const vein = STATIC_WORLD.goldVeins[id];
        miniCtx.beginPath();
        miniCtx.arc(vein.x * scale, vein.y * scale, 4, 0, Math.PI * 2);
        miniCtx.fillStyle = vein.isOccupied ? "rgba(170,170,170,0.4)" : "rgba(241,196,15,0.45)";
        miniCtx.fill();
    }

    for (const id in SERVER_STATE.buildings) {
        const b = SERVER_STATE.buildings[id];
        miniCtx.fillStyle = b.ownerId === myId
            ? "#52d69a"
            : (meServer?.clan && b.clan && meServer.clan === b.clan ? "#bb86fc" : "#ff7b7b");
        miniCtx.fillRect(b.x * scale - 2, b.y * scale - 2, 4, 4);
    }

    for (const id in SERVER_STATE.players) {
        const p = SERVER_STATE.players[id];
        miniCtx.beginPath();
        miniCtx.arc(p.x * scale, p.y * scale, p.id === myId ? 4.5 : 3, 0, Math.PI * 2);
        miniCtx.fillStyle = p.id === myId
            ? "#ffffff"
            : (meServer?.clan && p.clan && meServer.clan === p.clan ? "#d3a9ff" : "#ff6b6b");
        miniCtx.fill();
    }

    const viewW = canvas.width / camera.zoom * scale;
    const viewH = canvas.height / camera.zoom * scale;
    miniCtx.strokeStyle = "rgba(255,255,255,0.22)";
    miniCtx.strokeRect(camera.x * scale - viewW / 2, camera.y * scale - viewH / 2, viewW, viewH);
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const meServer = SERVER_STATE.players[myId];
    const meRender = RENDER_STATE.players[myId];

    if (meServer && meRender) {
        camera.targetZoom = clamp(camera.targetZoom, 0.68, 1.12);
        camera.zoom = lerp(camera.zoom, camera.targetZoom, 0.08);

        meRender.x += (meServer.x - meRender.x) * 0.18;
        meRender.y += (meServer.y - meRender.y) * 0.18;

        camera.x = lerp(camera.x, meRender.x, 0.08);
        camera.y = lerp(camera.y, meRender.y, 0.08);

        screenShake.power *= 0.88;
        const shakeX = (Math.random() - 0.5) * screenShake.power;
        const shakeY = (Math.random() - 0.5) * screenShake.power;

        ctx.save();
        ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        if (isImageReady("bg")) {
            const ptrn = ctx.createPattern(IMAGES.bg, "repeat");
            ctx.fillStyle = ptrn;
            ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
        } else {
            drawGround();
        }

        drawMapBorder();

        for (const id in STATIC_WORLD.goldVeins) drawGoldVein(STATIC_WORLD.goldVeins[id]);
        for (const id in STATIC_WORLD.envs) drawEnv(STATIC_WORLD.envs[id], meRender);
        for (const id in SERVER_STATE.foods) drawFood(SERVER_STATE.foods[id]);
        for (const id in SERVER_STATE.buildings) drawBuilding(SERVER_STATE.buildings[id], meServer);

        drawTrails();
        drawRings();
        drawFlashes();

        for (const id in SERVER_STATE.projectiles) {
            const prj = SERVER_STATE.projectiles[id];
            if (prj.type === "arrow") spawnTrail(prj.x, prj.y, "rgba(220,220,220,0.15)", 3);
            if (prj.type === "magic") spawnTrail(prj.x, prj.y, "rgba(170,90,255,0.28)", 5);
            if (prj.type === "fireball") spawnTrail(prj.x, prj.y, "rgba(255,120,60,0.32)", 7);
            drawProjectile(prj);
        }

        for (const id in SERVER_STATE.units) {
            const uS = SERVER_STATE.units[id];
            if (!RENDER_STATE.units[id]) {
                RENDER_STATE.units[id] = { x: uS.x, y: uS.y };
            }
            const uR = RENDER_STATE.units[id];
            uR.x += (uS.x - uR.x) * 0.22;
            uR.y += (uS.y - uR.y) * 0.22;
            drawUnit(uS, uR, meServer);
        }

        for (const id in SERVER_STATE.players) {
            const pS = SERVER_STATE.players[id];
            if (!RENDER_STATE.players[id]) {
                RENDER_STATE.players[id] = { x: pS.x, y: pS.y };
            }
            const pR = RENDER_STATE.players[id];
            pR.x += (pS.x - pR.x) * 0.18;
            pR.y += (pS.y - pR.y) * 0.18;
            drawPlayer(pS, pR, meServer);
        }

        drawPlacementPreview(meServer);
        drawParticles();
        drawFloatTexts();

        ctx.restore();

        minimapTick += 1;
        if (minimapTick % 3 === 0) drawMinimap(meServer);
    }

    requestAnimationFrame(gameLoop);
}