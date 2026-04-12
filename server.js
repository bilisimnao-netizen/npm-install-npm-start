const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ["websocket", "polling"]
});

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

const CONFIG = {
    MAP_SIZE: 9000,
    TICK_RATE: 1000 / 24,
    MAX_LOOSE_FOOD: 420,
    GOLD_VEIN_COUNT: 8,
    ENV_COUNT: 38,
    VIEW_DISTANCE: 2200,
    FOOD_VIEW_DISTANCE: 1600,
    PROJECTILE_VIEW_DISTANCE: 2200,
    BUILD_RANGE: 340,
    BUILDING_MIN_DISTANCE: 170,
    ENV_MIN_DISTANCE: 160,
    GOLD_VEIN_MIN_DISTANCE: 850,
    ENV_WORLD_MIN_DISTANCE: 190,
    SELL_REFUND_RATE: 0.65,
    MINE_INCOME_INTERVAL: 60,
    STATS: {
        lord: { hp: 1000, maxHp: 1000, speed: 11.5, radius: 40 },

        house:     { hp: 520,  cost: 250,  radius: 42, popBonus: 10 },
        tower:     { hp: 1200, cost: 250,  radius: 46, dmg: 15, range: 420, attackDelay: 34 },
        mine:      { hp: 820,  cost: 500,  radius: 54, income: 10 },
        magetower: { hp: 1500, cost: 1500, radius: 48, dmg: 38, range: 520, attackDelay: 52 },

        soldier: { hp: 60,  dmg: 8,  range: 55,  speed: 11.2, cost: 15,  radius: 18, attackDelay: 18 },
        knight:  { hp: 200, dmg: 20, range: 66,  speed: 10.0, cost: 75,  radius: 22, attackDelay: 26 },
        archer:  { hp: 52,  dmg: 25, range: 360, speed: 10.5, cost: 125, radius: 18, attackDelay: 32 },
        mage:    { hp: 80,  dmg: 45, range: 410, speed: 9.0,  cost: 350, radius: 20, attackDelay: 46 },
        dragon:  { hp: 600, dmg: 70, range: 165, speed: 10.8, cost: 450, radius: 34, attackDelay: 40 }
    }
};

const STATE = {
    players: {},
    units: {},
    buildings: {},
    foods: {},
    envs: {},
    goldVeins: {},
    projectiles: {},
    clans: {}
};

let entityCounter = 0;
let ticks = 0;

function generateId(prefix) {
    entityCounter += 1;
    return `${prefix}_${entityCounter}`;
}

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function getDist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

function publicPlayerName(p) {
    return p.clan ? `[${p.clan}] ${p.name}` : p.name;
}

function sendSystemMessage(msg, color = "#ffffff", extra = {}) {
    io.emit("chatMsg", { sender: "SİSTEM", msg, color, ...extra });
}

function canAttack(attackerOwnerId, attackerClan, targetOwnerId, targetClan) {
    if (attackerOwnerId === targetOwnerId) return false;
    if (attackerClan && targetClan && attackerClan === targetClan) return false;
    return true;
}

function spawnLooseFood(x = null, y = null, val = null) {
    const id = generateId("f");
    STATE.foods[id] = {
        id,
        x: x ?? rand(30, CONFIG.MAP_SIZE - 30),
        y: y ?? rand(30, CONFIG.MAP_SIZE - 30),
        val: val ?? (Math.random() > 0.9 ? 15 : 3)
    };
}

function createProjectile({
    x, y, targetId, targetType, ownerId, clan, type, dmg, speed = 22, radius = 8, splash = 0
}) {
    const id = generateId("prj");
    STATE.projectiles[id] = {
        id,
        x,
        y,
        targetId,
        targetType,
        ownerId,
        clan,
        type,
        dmg,
        speed,
        radius,
        splash,
        life: 80
    };
}

function addClan(tag) {
    if (!tag) return null;
    if (!STATE.clans[tag]) {
        STATE.clans[tag] = {
            tag,
            members: []
        };
    }
    return STATE.clans[tag];
}

function joinClan(playerId, rawTag) {
    const player = STATE.players[playerId];
    if (!player) return;

    const tag = String(rawTag || "").trim().toUpperCase().substring(0, 6);
    if (!tag) return;

    leaveClan(playerId, true);

    const clan = addClan(tag);
    clan.members.push(playerId);
    player.clan = tag;

    sendSystemMessage(`${player.name}, [${tag}] klanına katıldı.`, "#b084ff");
}

function leaveClan(playerId, silent = false) {
    const player = STATE.players[playerId];
    if (!player || !player.clan) return;

    const clan = STATE.clans[player.clan];
    if (clan) {
        clan.members = clan.members.filter(id => id !== playerId);
        if (clan.members.length === 0) delete STATE.clans[player.clan];
    }

    const oldTag = player.clan;
    player.clan = "";

    if (!silent) {
        sendSystemMessage(`${player.name}, [${oldTag}] klanından ayrıldı.`, "#95a5a6");
    }
}

function getClanSummary() {
    const out = {};
    for (const tag in STATE.clans) {
        out[tag] = {
            tag,
            members: STATE.clans[tag].members
                .map(id => STATE.players[id])
                .filter(Boolean)
                .map(p => ({ id: p.id, name: p.name }))
        };
    }
    return out;
}

function emitClanState(playerId) {
    const socket = io.sockets.sockets.get(playerId);
    const p = STATE.players[playerId];
    if (!socket || !p) return;

    socket.emit("clanState", {
        myClan: p.clan || "",
        clans: getClanSummary()
    });
}

function emitClanStateToAll() {
    for (const id in STATE.players) emitClanState(id);
}

function cleanupOwnedEntities(ownerId) {
    for (const uid in STATE.units) {
        if (STATE.units[uid].ownerId === ownerId) delete STATE.units[uid];
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (b.ownerId !== ownerId) continue;

        if (b.type === "mine" && b.veinId && STATE.goldVeins[b.veinId]) {
            STATE.goldVeins[b.veinId].isOccupied = false;
        }
        delete STATE.buildings[bid];
    }

    for (const pid in STATE.projectiles) {
        if (STATE.projectiles[pid].ownerId === ownerId) delete STATE.projectiles[pid];
    }
}

function killPlayer(playerId, killerOwnerId = null) {
    const player = STATE.players[playerId];
    if (!player) return;

    const deadName = publicPlayerName(player);
    let msg = `☠️ ${deadName} katledildi!`;

    if (killerOwnerId && STATE.players[killerOwnerId]) {
        msg = `☠️ ${deadName}, ${publicPlayerName(STATE.players[killerOwnerId])} tarafından yok edildi!`;
        STATE.players[killerOwnerId].score += 500;
    }

    sendSystemMessage(msg, "#e74c3c", { isKillFeed: true });

    const lootAmount = Math.min(20, Math.max(8, Math.floor(player.gold / 40)));
    for (let i = 0; i < lootAmount; i++) {
        spawnLooseFood(
            clamp(player.x + rand(-130, 130), 25, CONFIG.MAP_SIZE - 25),
            clamp(player.y + rand(-130, 130), 25, CONFIG.MAP_SIZE - 25),
            18
        );
    }

    leaveClan(playerId, true);
    cleanupOwnedEntities(playerId);
    delete STATE.players[playerId];
    emitClanStateToAll();
}

function damageTarget(targetObj, amount, attackerOwnerId) {
    if (!targetObj) return;
    targetObj.hp -= amount;

    if (targetObj.hp > 0) return;

    if (STATE.players[targetObj.id]) {
        killPlayer(targetObj.id, attackerOwnerId);
        return;
    }

    if (STATE.units[targetObj.id]) {
        const dead = STATE.units[targetObj.id];
        if (STATE.players[dead.ownerId]) {
            STATE.players[dead.ownerId].population = Math.max(0, STATE.players[dead.ownerId].population - 1);
        }
        if (STATE.players[attackerOwnerId]) {
            STATE.players[attackerOwnerId].score += CONFIG.STATS[dead.type].cost || 10;
        }
        delete STATE.units[targetObj.id];
        return;
    }

    if (STATE.buildings[targetObj.id]) {
        const dead = STATE.buildings[targetObj.id];

        if (dead.type === "house" && STATE.players[dead.ownerId]) {
            STATE.players[dead.ownerId].maxPop = Math.max(
                10,
                STATE.players[dead.ownerId].maxPop - CONFIG.STATS.house.popBonus
            );
            if (STATE.players[dead.ownerId].population > STATE.players[dead.ownerId].maxPop) {
                STATE.players[dead.ownerId].population = STATE.players[dead.ownerId].maxPop;
            }
        }

        if (dead.type === "mine" && dead.veinId && STATE.goldVeins[dead.veinId]) {
            STATE.goldVeins[dead.veinId].isOccupied = false;
        }

        if (STATE.players[attackerOwnerId]) {
            STATE.players[attackerOwnerId].score += CONFIG.STATS[dead.type].cost || 100;
        }

        delete STATE.buildings[targetObj.id];
    }
}

function applySplashDamage(projectile, x, y) {
    if (!projectile.splash) return;

    for (const pid in STATE.players) {
        const p = STATE.players[pid];
        if (!canAttack(projectile.ownerId, projectile.clan, p.id, p.clan)) continue;
        if (getDist(x, y, p.x, p.y) <= projectile.splash) {
            damageTarget(p, Math.floor(projectile.dmg * 0.55), projectile.ownerId);
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        if (!canAttack(projectile.ownerId, projectile.clan, u.ownerId, u.clan)) continue;
        if (getDist(x, y, u.x, u.y) <= projectile.splash) {
            damageTarget(u, Math.floor(projectile.dmg * 0.55), projectile.ownerId);
        }
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (!canAttack(projectile.ownerId, projectile.clan, b.ownerId, b.clan)) continue;
        if (getDist(x, y, b.x, b.y) <= projectile.splash) {
            damageTarget(b, Math.floor(projectile.dmg * 0.45), projectile.ownerId);
        }
    }
}

function generateSpacedPoints(count, minDistance, padding = 200) {
    const points = [];
    let tries = 0;
    const maxTries = count * 200;

    while (points.length < count && tries < maxTries) {
        tries += 1;
        const x = rand(padding, CONFIG.MAP_SIZE - padding);
        const y = rand(padding, CONFIG.MAP_SIZE - padding);

        let ok = true;
        for (const p of points) {
            if (getDist(x, y, p.x, p.y) < minDistance) {
                ok = false;
                break;
            }
        }

        if (ok) points.push({ x, y });
    }

    return points;
}

function initWorld() {
    const envPoints = generateSpacedPoints(CONFIG.ENV_COUNT, CONFIG.ENV_WORLD_MIN_DISTANCE, 180);
    envPoints.forEach((p, i) => {
        STATE.envs[`env_${i}`] = {
            id: `env_${i}`,
            x: p.x,
            y: p.y,
            type: Math.random() > 0.58 ? "tree" : "rock",
            radius: rand(48, 84)
        };
    });

    const veinPoints = generateSpacedPoints(CONFIG.GOLD_VEIN_COUNT, CONFIG.GOLD_VEIN_MIN_DISTANCE, 280);
    veinPoints.forEach((p) => {
        const id = generateId("vein");
        STATE.goldVeins[id] = {
            id,
            x: p.x,
            y: p.y,
            radius: 82,
            isOccupied: false
        };
    });

    for (let i = 0; i < CONFIG.MAX_LOOSE_FOOD; i++) spawnLooseFood();
}

initWorld();

function isAreaBlocked(x, y, radius, ignoreBuildingId = null) {
    for (const bid in STATE.buildings) {
        if (bid === ignoreBuildingId) continue;
        const b = STATE.buildings[bid];
        const blockRadius = (CONFIG.STATS[b.type]?.radius || 42) + radius + CONFIG.BUILDING_MIN_DISTANCE;
        if (getDist(x, y, b.x, b.y) < blockRadius) return true;
    }

    for (const eid in STATE.envs) {
        const e = STATE.envs[eid];
        if (getDist(x, y, e.x, e.y) < e.radius + radius + CONFIG.ENV_MIN_DISTANCE) return true;
    }

    return false;
}

function findMineVeinForPlacement(x, y) {
    for (const vid in STATE.goldVeins) {
        const vein = STATE.goldVeins[vid];
        if (!vein.isOccupied && getDist(x, y, vein.x, vein.y) < 110) {
            return vein;
        }
    }
    return null;
}

function getClosestOwnedBuildingAt(ownerId, x, y) {
    let best = null;
    let bestDist = Infinity;

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (b.ownerId !== ownerId) continue;
        const dist = getDist(x, y, b.x, b.y);
        const radius = CONFIG.STATS[b.type]?.radius || 45;
        if (dist <= radius + 40 && dist < bestDist) {
            best = b;
            bestDist = dist;
        }
    }

    return best;
}

function findNearestEnemyForUnit(unit) {
    const stats = CONFIG.STATS[unit.type];
    let best = null;
    let bestDist = Infinity;
    const maxSearch = stats.range + 320;

    for (const pid in STATE.players) {
        const p = STATE.players[pid];
        if (!canAttack(unit.ownerId, unit.clan, p.id, p.clan)) continue;
        const d = getDist(unit.x, unit.y, p.x, p.y);
        if (d < bestDist && d <= maxSearch) {
            bestDist = d;
            best = { kind: "player", id: p.id, target: p, dist: d };
        }
    }

    for (const uid in STATE.units) {
        const other = STATE.units[uid];
        if (other.id === unit.id) continue;
        if (!canAttack(unit.ownerId, unit.clan, other.ownerId, other.clan)) continue;
        const d = getDist(unit.x, unit.y, other.x, other.y);
        if (d < bestDist && d <= maxSearch) {
            bestDist = d;
            best = { kind: "unit", id: other.id, target: other, dist: d };
        }
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (!canAttack(unit.ownerId, unit.clan, b.ownerId, b.clan)) continue;
        const d = getDist(unit.x, unit.y, b.x, b.y);
        if (d < bestDist && d <= maxSearch) {
            bestDist = d;
            best = { kind: "building", id: b.id, target: b, dist: d };
        }
    }

    return best;
}

function findNearestEnemyForBuilding(building) {
    const stats = CONFIG.STATS[building.type];
    let best = null;
    let bestDist = Infinity;

    for (const pid in STATE.players) {
        const p = STATE.players[pid];
        if (!canAttack(building.ownerId, building.clan, p.id, p.clan)) continue;
        const d = getDist(building.x, building.y, p.x, p.y);
        if (d <= stats.range && d < bestDist) {
            bestDist = d;
            best = { kind: "player", id: p.id, target: p, dist: d };
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        if (!canAttack(building.ownerId, building.clan, u.ownerId, u.clan)) continue;
        const d = getDist(building.x, building.y, u.x, u.y);
        if (d <= stats.range && d < bestDist) {
            bestDist = d;
            best = { kind: "unit", id: u.id, target: u, dist: d };
        }
    }

    return best;
}

function getUnitFormationTarget(unit, owner) {
    const h = hashString(unit.id);
    const group = h % 3;
    const angle = ((h % 360) / 180) * Math.PI;
    const baseRadius = 110 + group * 42 + (unit.type === "dragon" ? 80 : 0);

    return {
        x: owner.x + Math.cos(angle) * baseRadius,
        y: owner.y + Math.sin(angle) * baseRadius
    };
}

function buildVisibleStateFor(playerId) {
    const player = STATE.players[playerId];
    if (!player) return null;

    const out = {
        players: STATE.players,
        buildings: STATE.buildings,
        foods: {},
        units: {},
        projectiles: {},
        clans: getClanSummary()
    };

    for (const fid in STATE.foods) {
        const f = STATE.foods[fid];
        if (getDist(player.x, player.y, f.x, f.y) <= CONFIG.FOOD_VIEW_DISTANCE) {
            out.foods[fid] = f;
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        if (getDist(player.x, player.y, u.x, u.y) <= CONFIG.VIEW_DISTANCE) {
            out.units[uid] = u;
        }
    }

    for (const pid in STATE.projectiles) {
        const p = STATE.projectiles[pid];
        if (getDist(player.x, player.y, p.x, p.y) <= CONFIG.PROJECTILE_VIEW_DISTANCE) {
            out.projectiles[pid] = p;
        }
    }

    return out;
}

function emitStateToAllPlayers() {
    for (const pid in STATE.players) {
        const socket = io.sockets.sockets.get(pid);
        if (!socket) continue;
        socket.emit("stateUpdate", {
            state: buildVisibleStateFor(pid)
        });
    }
}

function getStaticWorld() {
    return {
        mapSize: CONFIG.MAP_SIZE,
        envs: STATE.envs,
        goldVeins: STATE.goldVeins
    };
}

io.on("connection", (socket) => {
    socket.on("joinGame", (data) => {
        const name = String(data?.name || "İsimsiz Lord").trim().substring(0, 15) || "İsimsiz Lord";
        const charType = ["recep", "togg", "bez"].includes(data?.charType) ? data.charType : "recep";

        const spawnX = rand(500, CONFIG.MAP_SIZE - 500);
        const spawnY = rand(500, CONFIG.MAP_SIZE - 500);

        STATE.players[socket.id] = {
            id: socket.id,
            name,
            charType,
            clan: "",
            x: spawnX,
            y: spawnY,
            targetX: spawnX,
            targetY: spawnY,
            speed: CONFIG.STATS.lord.speed,
            radius: CONFIG.STATS.lord.radius,
            hp: CONFIG.STATS.lord.hp,
            maxHp: CONFIG.STATS.lord.maxHp,
            gold: 800,
            population: 0,
            maxPop: 10,
            score: 0
        };

        socket.emit("init", {
            id: socket.id,
            staticWorld: getStaticWorld(),
            state: buildVisibleStateFor(socket.id)
        });

        const initialClan = String(data?.clan || "").trim().toUpperCase().substring(0, 6);
        if (initialClan) {
            joinClan(socket.id, initialClan);
        }

        emitClanStateToAll();
        sendSystemMessage(`${name} savaşa katıldı!`, "#2ecc71");
    });

    socket.on("mouseUpdate", (pos) => {
        const p = STATE.players[socket.id];
        if (!p) return;
        if (typeof pos?.x !== "number" || typeof pos?.y !== "number") return;

        p.targetX = clamp(pos.x, 0, CONFIG.MAP_SIZE);
        p.targetY = clamp(pos.y, 0, CONFIG.MAP_SIZE);
    });

    socket.on("buyUnit", (type) => {
        const p = STATE.players[socket.id];
        if (!p) return;
        if (!["soldier", "knight", "archer", "mage", "dragon"].includes(type)) return;

        const stats = CONFIG.STATS[type];
        if (p.gold < stats.cost) {
            socket.emit("systemAlert", "Yetersiz altın!");
            return;
        }

        if (p.population >= p.maxPop) {
            socket.emit("systemAlert", "Ordu sınırına ulaştın! Ev inşa et.");
            return;
        }

        p.gold -= stats.cost;
        p.score += stats.cost;
        p.population += 1;

        const unitId = generateId("u");
        STATE.units[unitId] = {
            id: unitId,
            ownerId: p.id,
            clan: p.clan,
            type,
            x: clamp(p.x + rand(-30, 30), 0, CONFIG.MAP_SIZE),
            y: clamp(p.y + rand(-30, 30), 0, CONFIG.MAP_SIZE),
            hp: stats.hp,
            maxHp: stats.hp,
            lastAttackTick: 0
        };

        socket.emit("actionSuccess", { type: "spawn" });
    });

    socket.on("placeBuilding", ({ type, x, y }) => {
        const p = STATE.players[socket.id];
        if (!p) return;
        if (!["house", "tower", "mine", "magetower"].includes(type)) return;

        if (typeof x !== "number" || typeof y !== "number") return;
        x = clamp(x, 0, CONFIG.MAP_SIZE);
        y = clamp(y, 0, CONFIG.MAP_SIZE);

        if (getDist(p.x, p.y, x, y) > CONFIG.BUILD_RANGE) {
            socket.emit("systemAlert", "Yapıyı çok uzağa kuramazsın.");
            return;
        }

        const stats = CONFIG.STATS[type];
        if (p.gold < stats.cost) {
            socket.emit("systemAlert", "Yetersiz altın!");
            return;
        }

        let placeX = x;
        let placeY = y;
        let linkedVeinId = null;

        if (type === "mine") {
            const vein = findMineVeinForPlacement(x, y);
            if (!vein) {
                socket.emit("systemAlert", "Maden sadece altın damarı üstüne kurulabilir.");
                return;
            }
            if (vein.isOccupied) {
                socket.emit("systemAlert", "Bu altın damarı dolu.");
                return;
            }
            placeX = vein.x;
            placeY = vein.y;
            linkedVeinId = vein.id;
        }

        if (isAreaBlocked(placeX, placeY, stats.radius)) {
            socket.emit("systemAlert", "Bu bölge çok sıkışık. Daha boş bir yere kur.");
            return;
        }

        p.gold -= stats.cost;
        p.score += stats.cost;

        const bid = generateId("b");
        STATE.buildings[bid] = {
            id: bid,
            ownerId: p.id,
            clan: p.clan,
            type,
            x: placeX,
            y: placeY,
            hp: stats.hp,
            maxHp: stats.hp,
            veinId: linkedVeinId,
            lastAttackTick: 0
        };

        if (type === "house") p.maxPop += CONFIG.STATS.house.popBonus;
        if (linkedVeinId) STATE.goldVeins[linkedVeinId].isOccupied = true;

        socket.emit("actionSuccess", { type: "build" });
    });

    socket.on("sellAt", ({ x, y }) => {
        const p = STATE.players[socket.id];
        if (!p) return;
        if (typeof x !== "number" || typeof y !== "number") return;

        const b = getClosestOwnedBuildingAt(socket.id, x, y);
        if (!b) {
            socket.emit("systemAlert", "Satılacak kendi yapın bulunamadı.");
            return;
        }

        if (getDist(p.x, p.y, b.x, b.y) > CONFIG.BUILD_RANGE + 120) {
            socket.emit("systemAlert", "Bu yapıyı satmak için biraz yaklaş.");
            return;
        }

        const cost = CONFIG.STATS[b.type]?.cost || 0;
        const refund = Math.floor(cost * CONFIG.SELL_REFUND_RATE);
        p.gold += refund;

        if (b.type === "house") {
            p.maxPop = Math.max(10, p.maxPop - CONFIG.STATS.house.popBonus);
            if (p.population > p.maxPop) p.population = p.maxPop;
        }

        if (b.type === "mine" && b.veinId && STATE.goldVeins[b.veinId]) {
            STATE.goldVeins[b.veinId].isOccupied = false;
        }

        delete STATE.buildings[b.id];
        socket.emit("systemAlert", `Yapı satıldı. +${refund} altın`);
    });

    socket.on("joinClan", ({ tag }) => {
        const p = STATE.players[socket.id];
        if (!p) return;

        const cleanTag = String(tag || "").trim().toUpperCase().substring(0, 6);
        if (!cleanTag) {
            socket.emit("systemAlert", "Geçerli bir klan etiketi yaz.");
            return;
        }

        joinClan(socket.id, cleanTag);

        for (const uid in STATE.units) {
            if (STATE.units[uid].ownerId === socket.id) {
                STATE.units[uid].clan = cleanTag;
            }
        }

        for (const bid in STATE.buildings) {
            if (STATE.buildings[bid].ownerId === socket.id) {
                STATE.buildings[bid].clan = cleanTag;
            }
        }

        emitClanStateToAll();
    });

    socket.on("leaveClan", () => {
        const p = STATE.players[socket.id];
        if (!p) return;

        leaveClan(socket.id);

        for (const uid in STATE.units) {
            if (STATE.units[uid].ownerId === socket.id) {
                STATE.units[uid].clan = "";
            }
        }

        for (const bid in STATE.buildings) {
            if (STATE.buildings[bid].ownerId === socket.id) {
                STATE.buildings[bid].clan = "";
            }
        }

        emitClanStateToAll();
    });

    socket.on("sendChat", (msg) => {
        const p = STATE.players[socket.id];
        if (!p || typeof msg !== "string") return;

        const safeMsg = msg.substring(0, 80).replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
        if (!safeMsg) return;

        io.emit("chatMsg", {
            sender: publicPlayerName(p),
            msg: safeMsg,
            color: "#ffffff"
        });
    });

    socket.on("disconnect", () => {
        const p = STATE.players[socket.id];
        if (!p) return;

        leaveClan(socket.id, true);
        cleanupOwnedEntities(socket.id);
        delete STATE.players[socket.id];
        emitClanStateToAll();
        sendSystemMessage(`${p.name} savaşı terk etti.`, "#95a5a6");
    });
});

setInterval(() => {
    ticks += 1;

    // Lord hareketi ve altın toplama
    for (const pid in STATE.players) {
        const p = STATE.players[pid];

        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 6) {
            p.x += (dx / dist) * p.speed;
            p.y += (dy / dist) * p.speed;
        }

        p.x = clamp(p.x, p.radius, CONFIG.MAP_SIZE - p.radius);
        p.y = clamp(p.y, p.radius, CONFIG.MAP_SIZE - p.radius);

        for (const fid in STATE.foods) {
            const f = STATE.foods[fid];
            if (getDist(p.x, p.y, f.x, f.y) < p.radius + 15) {
                p.gold += f.val;
                p.score += f.val;
                delete STATE.foods[fid];
                spawnLooseFood();
            }
        }
    }

    // Birimler: ağır separation yerine hafif formasyon
    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        const owner = STATE.players[u.ownerId];
        if (!owner) {
            delete STATE.units[uid];
            continue;
        }

        const stats = CONFIG.STATS[u.type];
        const enemy = findNearestEnemyForUnit(u);

        let targetX;
        let targetY;

        if (enemy && enemy.dist <= stats.range + 230) {
            targetX = enemy.target.x;
            targetY = enemy.target.y;
        } else {
            const formation = getUnitFormationTarget(u, owner);
            targetX = formation.x;
            targetY = formation.y;
        }

        const dx = targetX - u.x;
        const dy = targetY - u.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 6) {
            const moveSpeed = enemy ? stats.speed * 1.02 : stats.speed * 0.92;
            u.x += (dx / dist) * moveSpeed;
            u.y += (dy / dist) * moveSpeed;
        }

        u.x = clamp(u.x, 0, CONFIG.MAP_SIZE);
        u.y = clamp(u.y, 0, CONFIG.MAP_SIZE);
    }

    // Savaş
    if (ticks % 2 === 0) {
        for (const uid in STATE.units) {
            const u = STATE.units[uid];
            if (!u) continue;

            const stats = CONFIG.STATS[u.type];
            const enemy = findNearestEnemyForUnit(u);
            if (!enemy) continue;
            if (enemy.dist > stats.range) continue;
            if (ticks - u.lastAttackTick < stats.attackDelay) continue;

            u.lastAttackTick = ticks;

            if (u.type === "soldier" || u.type === "knight") {
                damageTarget(enemy.target, stats.dmg, u.ownerId);
            } else if (u.type === "archer") {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: enemy.id,
                    targetType: enemy.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: "arrow",
                    dmg: stats.dmg,
                    speed: 29,
                    radius: 6
                });
            } else if (u.type === "mage") {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: enemy.id,
                    targetType: enemy.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: "magic",
                    dmg: stats.dmg,
                    speed: 20,
                    radius: 9,
                    splash: 40
                });
            } else if (u.type === "dragon") {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: enemy.id,
                    targetType: enemy.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: "fireball",
                    dmg: stats.dmg,
                    speed: 17,
                    radius: 12,
                    splash: 70
                });
            }
        }

        for (const bid in STATE.buildings) {
            const b = STATE.buildings[bid];
            if (!b || !["tower", "magetower"].includes(b.type)) continue;

            const stats = CONFIG.STATS[b.type];
            const enemy = findNearestEnemyForBuilding(b);
            if (!enemy) continue;
            if (ticks - b.lastAttackTick < stats.attackDelay) continue;

            b.lastAttackTick = ticks;

            createProjectile({
                x: b.x,
                y: b.y,
                targetId: enemy.id,
                targetType: enemy.kind,
                ownerId: b.ownerId,
                clan: b.clan,
                type: b.type === "tower" ? "arrow" : "magic",
                dmg: stats.dmg,
                speed: b.type === "tower" ? 27 : 18,
                radius: b.type === "tower" ? 6 : 10,
                splash: b.type === "tower" ? 0 : 42
            });
        }
    }

    // Projectile
    for (const pid in STATE.projectiles) {
        const prj = STATE.projectiles[pid];

        let target = null;
        if (prj.targetType === "player") target = STATE.players[prj.targetId];
        else if (prj.targetType === "unit") target = STATE.units[prj.targetId];
        else if (prj.targetType === "building") target = STATE.buildings[prj.targetId];

        if (!target) {
            delete STATE.projectiles[pid];
            continue;
        }

        const dx = target.x - prj.x;
        const dy = target.y - prj.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= prj.radius + 12) {
            damageTarget(target, prj.dmg, prj.ownerId);

            if (prj.type === "magic" || prj.type === "fireball") {
                applySplashDamage(prj, target.x, target.y);
            }

            delete STATE.projectiles[pid];
            continue;
        }

        if (dist > 0) {
            prj.x += (dx / dist) * prj.speed;
            prj.y += (dy / dist) * prj.speed;
        }

        prj.life -= 1;
        if (prj.life <= 0) delete STATE.projectiles[pid];
    }

    // Maden geliri azaltıldı
    if (ticks % CONFIG.MINE_INCOME_INTERVAL === 0) {
        for (const bid in STATE.buildings) {
            const b = STATE.buildings[bid];
            if (b.type !== "mine") continue;

            const owner = STATE.players[b.ownerId];
            if (!owner) continue;

            owner.gold += CONFIG.STATS.mine.income;
            owner.score += Math.floor(CONFIG.STATS.mine.income * 0.35);
        }
    }

    emitStateToAllPlayers();
}, CONFIG.TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("[BAŞARILI] 6D.IO aktif. Port:", PORT);
});