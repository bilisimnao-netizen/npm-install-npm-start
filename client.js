const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimapCanvas');
const miniCtx = minimap.getContext('2d');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const deathOverlay = document.getElementById('deathOverlay');

let myId = null;
let MAP_SIZE = 10000;
let selectedChar = 'recep';
let gameStarted = false;
let playerDied = false;

let SERVER_STATE = {
    players: {},
    units: {},
    foods: {},
    buildings: {},
    envs: {},
    goldVeins: {},
    projectiles: {}
};

let PREV_PROJECTILES = {};

let RENDER_STATE = {
    players: {},
    units: {}
};

let camera = {
    x: 0,
    y: 0,
    zoom: 0.9,
    targetZoom: 0.9
};

let mouse = {
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0
};

let screenShake = { power: 0 };

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
    recep: '🧔',
    togg: '🚗',
    bez: '🧽',
    soldier: '⭐',
    knight: '🛡️',
    archer: '🏹',
    mage: '🧙',
    dragon: '🐲',
    house: '⛺',
    tower: '🗼',
    mine: '⛏️',
    magetower: '🔮'
};

const particles = [];
const floatTexts = [];
const trails = [];
const rings = [];
const flashes = [];

const IMAGES = {};
const imageFiles = {
    bg: 'bg.png',
    recep: 'recep.png',
    togg: 'togg.png',
    bez: 'bez.png',
    mine: 'mine.png',
    house: 'house.png',
    tower: 'tower.png',
    magetower: 'magetower.png',
    soldier: 'soldier.png',
    knight: 'knight.png',
    archer: 'archer.png',
    mage: 'mage.png',
    dragon: 'dragon.png',
    vein: 'vein.png',
    tree: 'tree.png',
    rock: 'rock.png'
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
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

window.selectChar = function selectChar(type, el) {
    selectedChar = type;
    document.querySelectorAll('.char-box').forEach(box => box.classList.remove('active'));
    el.classList.add('active');
};

document.getElementById('playBtn').addEventListener('click', () => {
    const clan = document.getElementById('clanName').value.trim();
    const name = document.getElementById('playerName').value.trim() || 'İsimsiz Lord';

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('uiLayer').style.display = 'block';
    canvas.style.display = 'block';

    socket.emit('joinGame', {
        name,
        clan,
        charType: selectedChar
    });
});

window.buyItem = function buyItem(type) {
    socket.emit('buy', type);
};

window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.worldX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
    mouse.worldY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
});

window.addEventListener('wheel', (e) => {
    if (!gameStarted || playerDied) return;
    const delta = Math.sign(e.deltaY) * 0.05;
    camera.targetZoom = clamp(camera.targetZoom - delta, 0.65, 1.15);
}, { passive: true });

const keyMap = {
    c: 'house',
    e: 'tower',
    r: 'mine',
    f: 'magetower',
    t: 'soldier',
    y: 'knight',
    u: 'archer',
    i: 'mage',
    m: 'dragon'
};

window.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInput || playerDied) return;

    const key = e.key.toLowerCase();
    if (keyMap[key]) socket.emit('buy', keyMap[key]);
    if (key === '+') camera.targetZoom = clamp(camera.targetZoom + 0.05, 0.65, 1.15);
    if (key === '-') camera.targetZoom = clamp(camera.targetZoom - 0.05, 0.65, 1.15);
});

setInterval(() => {
    if (myId && SERVER_STATE.players[myId] && !playerDied) {
        socket.emit('mouseUpdate', { x: mouse.worldX, y: mouse.worldY });
    }
}, 33);

socket.on('init', (data) => {
    myId = data.id;
    MAP_SIZE = data.mapSize;
    SERVER_STATE = data.state;
    gameStarted = true;
    playerDied = false;
    deathOverlay.style.display = 'none';

    for (const id in SERVER_STATE.players) {
        RENDER_STATE.players[id] = {
            x: SERVER_STATE.players[id].x,
            y: SERVER_STATE.players[id].y
        };
    }

    for (const id in SERVER_STATE.units) {
        RENDER_STATE.units[id] = {
            x: SERVER_STATE.units[id].x,
            y: SERVER_STATE.units[id].y
        };
    }

    requestAnimationFrame(gameLoop);
});

socket.on('stateUpdate', (data) => {
    const oldPlayers = SERVER_STATE.players;
    const oldUnits = SERVER_STATE.units;
    const oldBuildings = SERVER_STATE.buildings;
    const oldFoods = SERVER_STATE.foods;
    const oldProjectiles = SERVER_STATE.projectiles || {};

    SERVER_STATE = data.state;

    for (const id in SERVER_STATE.players) {
        if (!RENDER_STATE.players[id]) {
            RENDER_STATE.players[id] = {
                x: SERVER_STATE.players[id].x,
                y: SERVER_STATE.players[id].y
            };
            spawnParticles(SERVER_STATE.players[id].x, SERVER_STATE.players[id].y, '#74b9ff', 12, 4);
        }
    }

    for (const id in SERVER_STATE.units) {
        if (!RENDER_STATE.units[id]) {
            RENDER_STATE.units[id] = {
                x: SERVER_STATE.units[id].x,
                y: SERVER_STATE.units[id].y
            };
            spawnParticles(SERVER_STATE.units[id].x, SERVER_STATE.units[id].y, '#f1c40f', 8, 2.5);
        }
    }

    for (const id in RENDER_STATE.players) {
        if (!SERVER_STATE.players[id]) delete RENDER_STATE.players[id];
    }

    for (const id in RENDER_STATE.units) {
        if (!SERVER_STATE.units[id]) delete RENDER_STATE.units[id];
    }

    detectProjectileBirthsAndImpacts(oldProjectiles, SERVER_STATE.projectiles || {});
    detectDamageAndEvents(oldPlayers, oldUnits, oldBuildings, oldFoods);

    if (myId && !SERVER_STATE.players[myId] && gameStarted && !playerDied) {
        playerDied = true;
        deathOverlay.style.display = 'flex';
        screenShake.power = 10;
        spawnExplosion(camera.x, camera.y, '#ff6b6b', 42);
    }

    updateHUD();
});

socket.on('chatMsg', (data) => {
    appendChatMessage(data.sender, data.msg, data.color || '#ffffff');

    if (data.isKillFeed && typeof window.pushKillFeed === 'function') {
        window.pushKillFeed(data.msg);
    }
});

socket.on('systemAlert', (msg) => {
    if (typeof window.showSystemAlert === 'function') window.showSystemAlert(msg);
});

socket.on('actionSuccess', (payload) => {
    const me = SERVER_STATE.players[myId];
    if (!me) return;

    if (payload.type === 'build') {
        screenShake.power = Math.max(screenShake.power, 4);
        spawnParticles(me.x, me.y, '#f1c40f', 18, 4);
        pushFloatText(me.x, me.y - 30, 'İnşa!', '#ffd85a');
        spawnPulseRing(me.x, me.y, 'rgba(255,216,90,0.7)', 20, 100);
    } else if (payload.type === 'spawn') {
        spawnParticles(me.x, me.y, '#ffffff', 12, 3);
        spawnFlash(me.x, me.y, 'rgba(255,255,255,0.8)', 30);
    }
});

socket.on('disconnect', () => {
    if (gameStarted && !playerDied) {
        playerDied = true;
        deathOverlay.style.display = 'flex';
    }
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text.length > 0) socket.emit('sendChat', text);
        chatInput.value = '';
    }
});

function appendChatMessage(sender, msg, color) {
    const div = document.createElement('div');
    div.style.marginBottom = '6px';
    div.innerHTML = `<strong style="color:${color}">${escapeHtml(sender)}:</strong> ${escapeHtml(msg)}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function detectDamageAndEvents(oldPlayers, oldUnits, oldBuildings, oldFoods) {
    const checkDamage = (oldObj, newObj, color) => {
        for (const id in newObj) {
            const prev = oldObj[id];
            const curr = newObj[id];
            if (!prev || !curr) continue;

            if (typeof prev.hp === 'number' && typeof curr.hp === 'number') {
                const delta = prev.hp - curr.hp;
                if (delta > 0) {
                    spawnParticles(curr.x, curr.y, color, Math.min(12, 4 + Math.floor(delta / 8)), 3.5);
                    pushFloatText(curr.x, curr.y - 10, `-${Math.floor(delta)}`, '#ff7f7f');
                    spawnFlash(curr.x, curr.y, 'rgba(255,255,255,0.6)', 20);
                    screenShake.power = Math.max(screenShake.power, Math.min(8, 1 + delta * 0.05));

                    if (curr.hp <= 0 || (curr.maxHp && curr.hp / curr.maxHp < 0.2)) {
                        spawnPulseRing(curr.x, curr.y, 'rgba(255,80,80,0.7)', 16, 70);
                    }
                }
            }
        }
    };

    checkDamage(oldPlayers, SERVER_STATE.players, '#ff7675');
    checkDamage(oldUnits, SERVER_STATE.units, '#ff7675');
    checkDamage(oldBuildings, SERVER_STATE.buildings, '#ffb347');

    if (myId && SERVER_STATE.players[myId] && oldFoods) {
        const me = SERVER_STATE.players[myId];
        let collectedCount = 0;

        for (const id in oldFoods) {
            if (!SERVER_STATE.foods[id]) {
                const food = oldFoods[id];
                if (food && getDist(food.x, food.y, me.x, me.y) < 160) {
                    collectedCount += food.val || 1;
                    spawnParticles(food.x, food.y, '#f1c40f', 4, 2.2);
                    spawnFlash(food.x, food.y, 'rgba(255,216,90,0.8)', 14);
                }
            }
        }

        if (collectedCount > 0) {
            pushFloatText(me.x, me.y - 55, `+${collectedCount} altın`, '#ffd85a');
        }
    }
}

function detectProjectileBirthsAndImpacts(oldProjectiles, newProjectiles) {
    for (const id in newProjectiles) {
        if (!oldProjectiles[id]) {
            const p = newProjectiles[id];

            if (p.type === 'arrow') {
                spawnParticles(p.x, p.y, '#e0c08b', 4, 1.4);
                spawnFlash(p.x, p.y, 'rgba(255,245,220,0.35)', 10);
            } else if (p.type === 'magic') {
                spawnParticles(p.x, p.y, '#b084ff', 10, 2.2);
                spawnPulseRing(p.x, p.y, 'rgba(160,100,255,0.8)', 8, 40);
                spawnFlash(p.x, p.y, 'rgba(170,120,255,0.55)', 18);
            } else if (p.type === 'fireball') {
                spawnParticles(p.x, p.y, '#ff8f3f', 12, 2.8);
                spawnFlash(p.x, p.y, 'rgba(255,140,70,0.6)', 22);
            }
        }
    }

    for (const id in oldProjectiles) {
        if (!newProjectiles[id]) {
            const p = oldProjectiles[id];

            if (p.type === 'arrow') {
                spawnParticles(p.x, p.y, '#d8d8d8', 7, 2.0);
                spawnFlash(p.x, p.y, 'rgba(255,255,255,0.35)', 10);
            } else if (p.type === 'magic') {
                spawnExplosion(p.x, p.y, '#b26cff', 16);
                spawnPulseRing(p.x, p.y, 'rgba(178,108,255,0.75)', 12, 55);
                screenShake.power = Math.max(screenShake.power, 2.8);
            } else if (p.type === 'fireball') {
                spawnExplosion(p.x, p.y, '#ff8a3d', 24);
                spawnPulseRing(p.x, p.y, 'rgba(255,120,60,0.7)', 18, 70);
                screenShake.power = Math.max(screenShake.power, 4.5);
            }
        }
    }

    PREV_PROJECTILES = { ...newProjectiles };
}

function spawnParticles(x, y, color, count = 8, speed = 3) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * speed * 2,
            vy: (Math.random() - 0.5) * speed * 2,
            life: 20 + Math.random() * 20,
            maxLife: 20 + Math.random() * 20,
            size: 2 + Math.random() * 4,
            color
        });
    }
}

function spawnExplosion(x, y, color, count = 18) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 28 + Math.random() * 20,
            maxLife: 28 + Math.random() * 20,
            size: 3 + Math.random() * 6,
            color
        });
    }
}

function pushFloatText(x, y, text, color) {
    floatTexts.push({
        x,
        y,
        text,
        color,
        alpha: 1,
        vy: -0.5
    });
}

function spawnTrail(x, y, color, size = 10) {
    trails.push({
        x,
        y,
        size,
        alpha: 0.35,
        color
    });
}

function spawnPulseRing(x, y, color, start = 8, max = 60) {
    rings.push({
        x,
        y,
        radius: start,
        maxRadius: max,
        alpha: 0.8,
        color,
        width: 4
    });
}

function spawnFlash(x, y, color, size = 24) {
    flashes.push({
        x,
        y,
        size,
        alpha: 0.7,
        color
    });
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function getDist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function isImageReady(key) {
    return IMAGES[key] && IMAGES[key].complete && IMAGES[key].naturalWidth > 0;
}

function drawGround() {
    ctx.fillStyle = '#2c6b3e';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    for (let i = 0; i < 600; i++) {
        const x = (i * 137) % MAP_SIZE;
        const y = (i * 193) % MAP_SIZE;
        const r = 40 + (i % 6) * 18;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.02)';
        ctx.fill();
    }

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < MAP_SIZE; i += 250) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, MAP_SIZE);
        ctx.moveTo(0, i);
        ctx.lineTo(MAP_SIZE, i);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    for (let i = 0; i < MAP_SIZE; i += 100) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, MAP_SIZE);
        ctx.moveTo(0, i);
        ctx.lineTo(MAP_SIZE, i);
    }
    ctx.stroke();
}

function drawMapBorder() {
    ctx.lineWidth = 32;
    ctx.strokeStyle = 'rgba(10, 10, 10, 0.40)';
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
}

function drawShadow(x, y, radius, alpha = 0.22) {
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.82, radius * 0.9, radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fill();
}

function drawSelectionRing(x, y, radius, color = 'rgba(255,255,255,0.18)') {
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.28, radius * 0.98, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
}

function drawHP(x, y, hp, maxHp, radius) {
    const width = radius * 2.4;
    const height = 8;
    const yOffset = radius + 24;
    const ratio = clamp(hp / maxHp, 0, 1);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - width / 2, y - yOffset, width, height);

    const color =
        ratio > 0.65 ? '#2ecc71' :
        ratio > 0.35 ? '#f1c40f' :
        '#e74c3c';

    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y - yOffset, width * ratio, height);

    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - width / 2, y - yOffset, width, height);
}

function drawNameTag(x, y, text, color = '#ffffff') {
    ctx.font = 'bold 15px Ubuntu';
    ctx.textAlign = 'center';
    const padX = 12;
    const w = ctx.measureText(text).width + padX * 2;
    const h = 22;

    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.fillRect(x - w / 2, y - 64, w, h);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y - 48);
}

function drawGoldVein(vein) {
    if (isImageReady('vein')) {
        ctx.drawImage(IMAGES.vein, vein.x - vein.radius, vein.y - vein.radius, vein.radius * 2, vein.radius * 2);
        return;
    }

    ctx.beginPath();
    ctx.arc(vein.x, vein.y, vein.radius, 0, Math.PI * 2);
    ctx.fillStyle = vein.isOccupied ? 'rgba(140,140,140,0.10)' : 'rgba(241,196,15,0.12)';
    ctx.fill();

    ctx.setLineDash([16, 12]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = vein.isOccupied ? 'rgba(180,180,180,0.50)' : 'rgba(241,196,15,0.70)';
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(vein.x, vein.y, vein.radius * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = vein.isOccupied ? 'rgba(150,150,150,0.35)' : 'rgba(241,196,15,0.45)';
    ctx.fill();
}

function drawFood(food) {
    const r = food.val > 10 ? 9 : 5;
    ctx.beginPath();
    ctx.arc(food.x, food.y, r, 0, Math.PI * 2);

    const glow = food.val > 10 ? 16 : 8;
    ctx.shadowColor = '#f1c40f';
    ctx.shadowBlur = glow;
    ctx.fillStyle = '#f1c40f';
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#d68910';
    ctx.stroke();
}

function drawEnv(env, me) {
    const distToMe = me ? getDist(me.x, me.y, env.x, env.y) : 999999;
    ctx.globalAlpha = distToMe < env.radius + 20 ? 0.45 : 1;

    drawShadow(env.x, env.y, env.radius * 0.8, 0.18);

    if (isImageReady(env.type)) {
        ctx.drawImage(IMAGES[env.type], env.x - env.radius, env.y - env.radius, env.radius * 2, env.radius * 2);
    } else {
        ctx.beginPath();
        ctx.arc(env.x, env.y, env.radius, 0, Math.PI * 2);
        ctx.fillStyle = env.type === 'tree' ? '#2d6a4f' : '#6c757d';
        ctx.fill();
    }

    ctx.globalAlpha = 1;
}

function drawBuilding(b, meServer) {
    const isMine = b.ownerId === myId;
    const isClan = meServer?.clan && b.clan === meServer.clan;

    let ringColor = isMine ? 'rgba(93, 173, 226, 0.55)' : (isClan ? 'rgba(155, 89, 182, 0.55)' : 'rgba(231, 76, 60, 0.45)');
    let size = b.type === 'mine' ? 140 : 100;
    let radius = b.type === 'mine' ? 54 : 45;

    drawShadow(b.x, b.y, radius + 10, 0.24);

    if (isImageReady(b.type)) {
        ctx.drawImage(IMAGES[b.type], b.x - size / 2, b.y - size / 2, size, size);
    } else {
        ctx.fillStyle = isMine ? '#3498db' : (isClan ? '#9b59b6' : '#e74c3c');

        if (b.type === 'house') {
            ctx.fillRect(b.x - 34, b.y - 34, 68, 68);
        } else if (b.type === 'tower') {
            ctx.beginPath();
            ctx.arc(b.x, b.y, 42, 0, Math.PI * 2);
            ctx.fill();
        } else if (b.type === 'mine') {
            ctx.beginPath();
            ctx.moveTo(b.x, b.y - 50);
            ctx.lineTo(b.x + 45, b.y + 35);
            ctx.lineTo(b.x - 45, b.y + 35);
            ctx.closePath();
            ctx.fill();
        } else if (b.type === 'magetower') {
            ctx.fillStyle = '#8e44ad';
            ctx.fillRect(b.x - 22, b.y - 58, 44, 116);
        }
    }

    if (b.type === 'magetower') {
        spawnTrail(b.x, b.y - 14, 'rgba(170,90,255,0.14)', 9);
    }

    drawSelectionRing(b.x, b.y, radius, ringColor);
    drawHP(b.x, b.y, b.hp, b.maxHp, radius);
}

function drawProjectile(prj) {
    ctx.save();

    if (prj.type === 'arrow') {
        const angle = Math.atan2((prj.targetY || prj.y) - prj.y, (prj.targetX || prj.x) - prj.x);
        ctx.translate(prj.x, prj.y);
        ctx.rotate(angle);

        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(-10, -2, 20, 4);

        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(4, -5);
        ctx.lineTo(4, 5);
        ctx.closePath();
        ctx.fillStyle = '#dcdcdc';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(-15, -4);
        ctx.lineTo(-13, 0);
        ctx.lineTo(-15, 4);
        ctx.closePath();
        ctx.fillStyle = '#c5a36d';
        ctx.fill();
    } else if (prj.type === 'magic') {
        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#8e44ad';
        ctx.shadowColor = '#c39bd3';
        ctx.shadowBlur = 20;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,150,255,0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();
    } else if (prj.type === 'fireball') {
        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6b00';
        ctx.shadowColor = '#ffb347';
        ctx.shadowBlur = 25;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(prj.x, prj.y, 18, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,180,90,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    ctx.restore();
    ctx.shadowBlur = 0;
}

function drawUnit(uS, uR, meServer) {
    const statsRadius = uS.type === 'dragon' ? 35 : (uS.type === 'knight' ? 22 : 18);
    const isMine = uS.ownerId === myId;
    const isClan = meServer?.clan && uS.clan === meServer.clan;
    let ringColor = isMine ? 'rgba(93, 173, 226, 0.55)' : (isClan ? 'rgba(155, 89, 182, 0.55)' : 'rgba(231, 76, 60, 0.50)');
    let bodyColor = isMine ? '#5dade2' : (isClan ? '#af7ac5' : '#ec7063');

    if (uS.type === 'dragon') spawnTrail(uR.x, uR.y, 'rgba(255,120,60,0.8)', 14);

    drawShadow(uR.x, uR.y, statsRadius, 0.22);

    if (isImageReady(uS.type)) {
        ctx.drawImage(IMAGES[uS.type], uR.x - statsRadius * 1.55, uR.y - statsRadius * 1.55, statsRadius * 3.1, statsRadius * 3.1);
    } else {
        ctx.beginPath();
        ctx.arc(uR.x, uR.y, statsRadius, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1b1b1b';
        ctx.stroke();

        ctx.font = `${uS.type === 'dragon' ? 22 : 16}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(TYPE_EMOJI[uS.type] || '•', uR.x, uR.y + 5);
    }

    drawSelectionRing(uR.x, uR.y, statsRadius, ringColor);
    drawHP(uR.x, uR.y, uS.hp, uS.maxHp, statsRadius);
}

function drawPlayer(pS, pR, meServer) {
    const isMine = pS.id === myId;
    const isClan = meServer?.clan && pS.clan === meServer.clan;
    let ringColor = isMine ? 'rgba(46, 204, 113, 0.65)' : (isClan ? 'rgba(155,89,182,0.55)' : 'rgba(231,76,60,0.45)');
    let labelColor = isMine ? '#9cffbf' : '#ffffff';

    drawShadow(pR.x, pR.y, pS.radius + 4, 0.26);

    if (isImageReady(pS.charType)) {
        ctx.drawImage(IMAGES[pS.charType], pR.x - pS.radius * 1.5, pR.y - pS.radius * 1.5, pS.radius * 3, pS.radius * 3);
    } else {
        ctx.beginPath();
        ctx.arc(pR.x, pR.y, pS.radius, 0, Math.PI * 2);
        ctx.fillStyle = isMine ? '#27ae60' : (isClan ? '#8e44ad' : '#c0392b');
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#111';
        ctx.stroke();

        ctx.font = '34px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(TYPE_EMOJI[pS.charType] || '👑', pR.x, pR.y + 10);
    }

    drawSelectionRing(pR.x, pR.y, pS.radius + 3, ringColor);
    drawHP(pR.x, pR.y, pS.hp, pS.maxHp, pS.radius);
    const clanTag = pS.clan ? `[${pS.clan}] ` : '';
    drawNameTag(pR.x, pR.y, `${clanTag}${pS.name}`, labelColor);
}

function drawMouseReticle() {
    const x = mouse.worldX;
    const y = mouse.worldY;

    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 24, y);
    ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y);
    ctx.lineTo(x + 24, y);
    ctx.moveTo(x, y - 24);
    ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + 24);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawTrails() {
    for (let i = trails.length - 1; i >= 0; i--) {
        const t = trails[i];
        t.alpha -= 0.025;
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

function drawPulseRings() {
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.radius += 2.8;
        r.alpha -= 0.035;

        if (r.radius >= r.maxRadius || r.alpha <= 0.02) {
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
        f.alpha -= 0.06;
        f.size *= 1.08;

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

function updateAndDrawParticles() {
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

        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function updateAndDrawFloatTexts() {
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const t = floatTexts[i];
        t.y += t.vy;
        t.alpha -= 0.02;

        if (t.alpha <= 0) {
            floatTexts.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = t.alpha;
        ctx.font = 'bold 16px Ubuntu';
        ctx.textAlign = 'center';
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.globalAlpha = 1;
    }
}

function updateHUD() {
    const me = SERVER_STATE.players[myId];
    if (!me) return;

    document.getElementById('goldVal').textContent = Math.floor(me.gold);
    document.getElementById('armyVal').textContent = me.population;
    document.getElementById('popVal').textContent = me.maxPop;
    document.getElementById('scoreVal').textContent = Math.floor(me.score);

    for (const key in COSTS) {
        const btn = document.getElementById('btn_' + key);
        if (!btn) continue;

        const isUnit = ['soldier', 'knight', 'archer', 'mage', 'dragon'].includes(key);
        const canBuy = isUnit
            ? me.gold >= COSTS[key] && me.population < me.maxPop
            : me.gold >= COSTS[key];

        if (canBuy) btn.classList.remove('disabled');
        else btn.classList.add('disabled');
    }

    const arr = Object.values(SERVER_STATE.players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    let html = '';
    arr.forEach((p, i) => {
        const clanTag = p.clan ? `<span style="color:#ffd85a">[${escapeHtml(p.clan)}]</span> ` : '';
        const rowStyle = p.id === myId ? 'style="color:#7dffb3"' : '';
        html += `<li ${rowStyle}><span>${i + 1}. ${clanTag}${escapeHtml(p.name)}</span><span>${Math.floor(p.score)}</span></li>`;
    });

    document.getElementById('leaderList').innerHTML = html;
}

function drawMinimap(meServer) {
    miniCtx.clearRect(0, 0, minimap.width, minimap.height);
    miniCtx.fillStyle = '#132126';
    miniCtx.fillRect(0, 0, minimap.width, minimap.height);

    miniCtx.strokeStyle = 'rgba(255,255,255,0.04)';
    miniCtx.lineWidth = 1;
    miniCtx.beginPath();
    for (let i = 0; i < minimap.width; i += 25) {
        miniCtx.moveTo(i, 0);
        miniCtx.lineTo(i, minimap.height);
        miniCtx.moveTo(0, i);
        miniCtx.lineTo(minimap.width, i);
    }
    miniCtx.stroke();

    const scale = minimap.width / MAP_SIZE;

    for (const id in SERVER_STATE.goldVeins) {
        const vein = SERVER_STATE.goldVeins[id];
        miniCtx.beginPath();
        miniCtx.arc(vein.x * scale, vein.y * scale, Math.max(2, vein.radius * scale * 0.45), 0, Math.PI * 2);
        miniCtx.fillStyle = vein.isOccupied ? 'rgba(160,160,160,0.35)' : 'rgba(241,196,15,0.35)';
        miniCtx.fill();
    }

    for (const id in SERVER_STATE.buildings) {
        const b = SERVER_STATE.buildings[id];
        miniCtx.fillStyle = b.ownerId === myId ? '#52d69a' : '#f28482';
        miniCtx.fillRect(b.x * scale - 2, b.y * scale - 2, 4, 4);
    }

    for (const id in SERVER_STATE.players) {
        const p = SERVER_STATE.players[id];
        miniCtx.beginPath();
        miniCtx.arc(p.x * scale, p.y * scale, p.id === myId ? 4.5 : 3, 0, Math.PI * 2);
        miniCtx.fillStyle = p.id === myId ? '#ffffff' : (p.clan && meServer.clan && p.clan === meServer.clan ? '#bb86fc' : '#ff6b6b');
        miniCtx.fill();
    }

    const viewW = canvas.width / camera.zoom * scale;
    const viewH = canvas.height / camera.zoom * scale;
    const vx = camera.x * scale - viewW / 2;
    const vy = camera.y * scale - viewH / 2;

    miniCtx.strokeStyle = 'rgba(255,255,255,0.28)';
    miniCtx.lineWidth = 1.2;
    miniCtx.strokeRect(vx, vy, viewW, viewH);
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const meServer = SERVER_STATE.players[myId];
    const meRender = RENDER_STATE.players[myId];

    if (meServer && meRender) {
        camera.targetZoom = clamp(camera.targetZoom, 0.65, 1.15);
        camera.zoom = lerp(camera.zoom, camera.targetZoom, 0.08);

        meRender.x += (meServer.x - meRender.x) * 0.18;
        meRender.y += (meServer.y - meRender.y) * 0.18;

        camera.x = lerp(camera.x, meRender.x, 0.12);
        camera.y = lerp(camera.y, meRender.y, 0.12);

        screenShake.power *= 0.88;
        const shakeX = (Math.random() - 0.5) * screenShake.power;
        const shakeY = (Math.random() - 0.5) * screenShake.power;

        ctx.save();
        ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        if (isImageReady('bg')) {
            const ptrn = ctx.createPattern(IMAGES.bg, 'repeat');
            ctx.fillStyle = ptrn;
            ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
        } else {
            drawGround();
        }

        drawMapBorder();

        for (const id in SERVER_STATE.goldVeins) drawGoldVein(SERVER_STATE.goldVeins[id]);
        for (const id in SERVER_STATE.envs) drawEnv(SERVER_STATE.envs[id], meRender);
        for (const id in SERVER_STATE.foods) drawFood(SERVER_STATE.foods[id]);
        for (const id in SERVER_STATE.buildings) drawBuilding(SERVER_STATE.buildings[id], meServer);

        drawTrails();
        drawPulseRings();
        drawFlashes();

        for (const id in SERVER_STATE.projectiles) {
            const prj = SERVER_STATE.projectiles[id];
            if (prj.type === 'fireball') spawnTrail(prj.x, prj.y, 'rgba(255,120,60,0.6)', 8);
            if (prj.type === 'magic') spawnTrail(prj.x, prj.y, 'rgba(170,90,255,0.5)', 6);
            if (prj.type === 'arrow') spawnTrail(prj.x, prj.y, 'rgba(220,220,220,0.18)', 4);
            drawProjectile(prj);
        }

        for (const id in SERVER_STATE.units) {
            const uS = SERVER_STATE.units[id];
            const uR = RENDER_STATE.units[id];
            if (!uR) continue;

            uR.x += (uS.x - uR.x) * 0.32;
            uR.y += (uS.y - uR.y) * 0.32;
            drawUnit(uS, uR, meServer);
        }

        for (const id in SERVER_STATE.players) {
            const pS = SERVER_STATE.players[id];
            const pR = RENDER_STATE.players[id];
            if (!pR) continue;

            pR.x += (pS.x - pR.x) * 0.25;
            pR.y += (pS.y - pR.y) * 0.25;
            drawPlayer(pS, pR, meServer);
        }

        drawMouseReticle();
        updateAndDrawParticles();
        updateAndDrawFloatTexts();

        ctx.restore();
        drawMinimap(meServer);
    }

    requestAnimationFrame(gameLoop);
}