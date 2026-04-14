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
    MAP_SIZE: 10000,
    TICK_RATE: 1000 / 30,
    MAX_LOOSE_FOOD: 700,
    GOLD_VEIN_COUNT: 10,
    ENV_COUNT: 50,
    BUILD_RANGE: 280,
    BUILD_SPACING: 140,
    MINE_INCOME_INTERVAL_TICKS: 80,
    STATS: {
        lord: { hp: 1000, maxHp: 1000, speed: 12, radius: 40 },

        house:     { hp: 500,  cost: 250,  radius: 42, popBonus: 10 },
        tower:     { hp: 1200, cost: 250,  radius: 45, dmg: 15, range: 420, attackDelay: 36 },
        mine:      { hp: 800,  cost: 500,  radius: 52, income: 15 },
        magetower: { hp: 1500, cost: 1500, radius: 48, dmg: 38, range: 520, attackDelay: 54 },

        soldier: { hp: 60,  dmg: 8,  range: 55,  speed: 13, cost: 15,  radius: 18, attackDelay: 20 },
        knight:  { hp: 200, dmg: 20, range: 65,  speed: 11, cost: 75,  radius: 22, attackDelay: 30 },
        archer:  { hp: 50,  dmg: 25, range: 360, speed: 12, cost: 125, radius: 18, attackDelay: 34 },
        mage:    { hp: 80,  dmg: 45, range: 410, speed: 10, cost: 350, radius: 20, attackDelay: 48 },
        dragon:  { hp: 600, dmg: 70, range: 160, speed: 14, cost: 450, radius: 35, attackDelay: 40 }
    }
};

const STATE = {
    players: {},
    units: {},
    foods: {},
    buildings: {},
    envs: {},
    goldVeins: {},
    projectiles: {}
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

function sendSystemMessage(msg, color = "#ffffff", extra = {}) {
    io.emit("chatMsg", { sender: "SİSTEM", msg, color, ...extra });
}

function spawnLooseFood(x = null, y = null, val = null) {
    const id = generateId("f");
    STATE.foods[id] = {
        id,
        x: x ?? rand(25, CONFIG.MAP_SIZE - 25),
        y: y ?? rand(25, CONFIG.MAP_SIZE - 25),
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
        life: 85
    };
}

function isSameClan(a, b) {
    return a && b && a === b;
}

function canAttack(attackerOwnerId, attackerClan, targetOwnerId, targetClan) {
    if (attackerOwnerId === targetOwnerId) return false;
    if (isSameClan(attackerClan, targetClan)) return false;
    return true;
}

function awardScore(ownerId, amount) {
    const p = STATE.players[ownerId];
    if (p) p.score += amount;
}

function cleanupOwnedEntities(ownerId) {
    for (const uid in STATE.units) {
        if (STATE.units[uid].ownerId === ownerId) delete STATE.units[uid];
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (b.ownerId !== ownerId) continue;

        if (b.type === "mine") {
            for (const vId in STATE.goldVeins) {
                const vein = STATE.goldVeins[vId];
                if (getDist(vein.x, vein.y, b.x, b.y) < vein.radius + 20) {
                    vein.isOccupied = false;
                }
            }
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

    const playerName = player.clan ? `[${player.clan}] ${player.name}` : player.name;
    let msg = `☠️ ${playerName} katledildi!`;

    if (killerOwnerId && STATE.players[killerOwnerId]) {
        const killer = STATE.players[killerOwnerId];
        const killerName = killer.clan ? `[${killer.clan}] ${killer.name}` : killer.name;
        msg = `☠️ ${playerName}, ${killerName} tarafından yok edildi!`;
        awardScore(killerOwnerId, 500);
    }

    sendSystemMessage(msg, "#e74c3c", { isKillFeed: true });

    const lootAmount = Math.min(20, Math.max(8, Math.floor(player.gold / 40)));
    for (let i = 0; i < lootAmount; i++) {
        spawnLooseFood(
            clamp(player.x + rand(-120, 120), 25, CONFIG.MAP_SIZE - 25),
            clamp(player.y + rand(-120, 120), 25, CONFIG.MAP_SIZE - 25),
            18
        );
    }

    cleanupOwnedEntities(playerId);
    delete STATE.players[playerId];
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
        const owner = STATE.players[dead.ownerId];
        if (owner) owner.population = Math.max(0, owner.population - 1);

        awardScore(attackerOwnerId, CONFIG.STATS[dead.type]?.cost || 10);
        delete STATE.units[targetObj.id];
        return;
    }

    if (STATE.buildings[targetObj.id]) {
        const dead = STATE.buildings[targetObj.id];

        if (dead.type === "house") {
            const owner = STATE.players[dead.ownerId];
            if (owner) {
                owner.maxPop = Math.max(10, owner.maxPop - CONFIG.STATS.house.popBonus);
                if (owner.population > owner.maxPop) owner.population = owner.maxPop;
            }
        }

        if (dead.type === "mine") {
            for (const vId in STATE.goldVeins) {
                const vein = STATE.goldVeins[vId];
                if (getDist(vein.x, vein.y, dead.x, dead.y) < vein.radius + 20) {
                    vein.isOccupied = false;
                }
            }
        }

        awardScore(attackerOwnerId, CONFIG.STATS[dead.type]?.cost || 100);
        delete STATE.buildings[targetObj.id];
    }
}

function applySplashDamage(projectile, centerX, centerY) {
    if (!projectile.splash || projectile.splash <= 0) return;

    for (const pid in STATE.players) {
        const p = STATE.players[pid];
        if (!canAttack(projectile.ownerId, projectile.clan, p.id, p.clan)) continue;

        if (getDist(centerX, centerY, p.x, p.y) <= projectile.splash) {
            damageTarget(p, Math.floor(projectile.dmg * 0.55), projectile.ownerId);
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        if (!canAttack(projectile.ownerId, projectile.clan, u.ownerId, u.clan)) continue;

        if (getDist(centerX, centerY, u.x, u.y) <= projectile.splash) {
            damageTarget(u, Math.floor(projectile.dmg * 0.55), projectile.ownerId);
        }
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (!canAttack(projectile.ownerId, projectile.clan, b.ownerId, b.clan)) continue;

        if (getDist(centerX, centerY, b.x, b.y) <= projectile.splash) {
            damageTarget(b, Math.floor(projectile.dmg * 0.45), projectile.ownerId);
        }
    }
}

function generateSpacedPoints(count, minDistance, padding = 180) {
    const pts = [];
    let tries = 0;
    const maxTries = count * 250;

    while (pts.length < count && tries < maxTries) {
        tries += 1;
        const x = rand(padding, CONFIG.MAP_SIZE - padding);
        const y = rand(padding, CONFIG.MAP_SIZE - padding);

        let ok = true;
        for (const p of pts) {
            if (getDist(x, y, p.x, p.y) < minDistance) {
                ok = false;
                break;
            }
        }

        if (ok) pts.push({ x, y });
    }

    return pts;
}

function initWorld() {
    const envPoints = generateSpacedPoints(CONFIG.ENV_COUNT, 180, 160);
    envPoints.forEach((p, i) => {
        STATE.envs[`env_${i}`] = {
            id: `env_${i}`,
            x: p.x,
            y: p.y,
            type: Math.random() > 0.58 ? "tree" : "rock",
            radius: rand(50, 90)
        };
    });

    const veinPoints = generateSpacedPoints(CONFIG.GOLD_VEIN_COUNT, 800, 260);
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

    for (let i = 0; i < CONFIG.MAX_LOOSE_FOOD; i++) {
        spawnLooseFood();
    }

    console.log("[SİSTEM] Dünya oluşturuldu");
}

initWorld();

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
    const hash = Array.from(unit.id).reduce((a, c) => a + c.charCodeAt(0), 0);
    const group = hash % 3;
    const angle = ((hash % 360) / 180) * Math.PI;
    const baseRadius = 120 + group * 40 + (unit.type === "dragon" ? 80 : 0);

    return {
        x: owner.x + Math.cos(angle) * baseRadius,
        y: owner.y + Math.sin(angle) * baseRadius
    };
}

function makePublicState() {
    return {
        players: STATE.players,
        units: STATE.units,
        foods: STATE.foods,
        buildings: STATE.buildings,
        envs: STATE.envs,
        goldVeins: STATE.goldVeins,
        projectiles: STATE.projectiles
    };
}

io.on("connection", (socket) => {
    console.log("Oyuncu bağlandı:", socket.id);
        // GİZLİ HİLE: CTRL + SPACE = BEDAVA EJDERHA
    socket.on("secretDragon", () => {
        const p = STATE.players[socket.id];
        if (!p) return;

        const stats = CONFIG.STATS.dragon;
        const unitId = generateId("u");

        STATE.units[unitId] = {
            id: unitId,
            ownerId: p.id,
            clan: p.clan,
            type: "dragon",
            x: clamp(p.x + rand(-60, 60), 0, CONFIG.MAP_SIZE),
            y: clamp(p.y + rand(-60, 60), 0, CONFIG.MAP_SIZE),
            hp: stats.hp,
            maxHp: stats.hp,
            lastAttackTick: 0
        };
    });

    socket.on("joinGame", (data) => {
        const name = String(data?.name || "İsimsiz Lord").trim().substring(0, 15) || "İsimsiz Lord";
        const clan = String(data?.clan || "").trim().toUpperCase().substring(0, 6);
        const charType = ["recep", "togg", "bez"].includes(data?.charType) ? data.charType : "recep";

        STATE.players[socket.id] = {
            id: socket.id,
            name,
            clan,
            charType,
            x: rand(500, CONFIG.MAP_SIZE - 500),
            y: rand(500, CONFIG.MAP_SIZE - 500),
            targetX: 0,
            targetY: 0,
            speed: CONFIG.STATS.lord.speed,
            radius: CONFIG.STATS.lord.radius,
            hp: CONFIG.STATS.lord.hp,
            maxHp: CONFIG.STATS.lord.maxHp,
            gold: 800,
            population: 0,
            maxPop: 10,
            score: 0
        };

        const p = STATE.players[socket.id];
        p.targetX = p.x;
        p.targetY = p.y;

        socket.emit("init", {
            id: socket.id,
            mapSize: CONFIG.MAP_SIZE,
            state: makePublicState()
        });

        sendSystemMessage(`${clan ? `[${clan}] ` : ""}${name} savaşa katıldı!`, "#2ecc71");
    });

    socket.on("mouseUpdate", (pos) => {
        const p = STATE.players[socket.id];
        if (!p) return;
        if (typeof pos?.x !== "number" || typeof pos?.y !== "number") return;

        p.targetX = clamp(pos.x, 0, CONFIG.MAP_SIZE);
        p.targetY = clamp(pos.y, 0, CONFIG.MAP_SIZE);
    });

    socket.on("buy", (type) => {
        const p = STATE.players[socket.id];
        if (!p || !CONFIG.STATS[type]) return;

        const stats = CONFIG.STATS[type];
        if (p.gold < stats.cost) {
            socket.emit("systemAlert", "Yetersiz altın!");
            return;
        }

        if (["soldier", "knight", "archer", "mage", "dragon"].includes(type)) {
            if (p.population >= p.maxPop) {
                socket.emit("systemAlert", "Ordu sınırına ulaştın! Daha fazla ev inşa et.");
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
                x: clamp(p.x + rand(-35, 35), 0, CONFIG.MAP_SIZE),
                y: clamp(p.y + rand(-35, 35), 0, CONFIG.MAP_SIZE),
                hp: stats.hp,
                maxHp: stats.hp,
                lastAttackTick: 0
            };

            socket.emit("actionSuccess", { type: "spawn" });
            return;
        }

        if (["house", "tower", "mine", "magetower"].includes(type)) {
            for (const bid in STATE.buildings) {
                const b = STATE.buildings[bid];
                if (getDist(b.x, b.y, p.x, p.y) < CONFIG.BUILD_SPACING) {
                    socket.emit("systemAlert", "Buraya çok yakın başka yapı var!");
                    return;
                }
            }

            let buildX = p.x;
            let buildY = p.y;
            let mineVeinId = null;

            if (type === "mine") {
                for (const vid in STATE.goldVeins) {
                    const vein = STATE.goldVeins[vid];
                    if (!vein.isOccupied && getDist(vein.x, vein.y, p.x, p.y) < vein.radius + 20) {
                        mineVeinId = vid;
                        buildX = vein.x;
                        buildY = vein.y;
                        break;
                    }
                }

                if (!mineVeinId) {
                    socket.emit("systemAlert", "Maden sadece altın damarı üstüne kurulabilir!");
                    return;
                }
            }

            p.gold -= stats.cost;
            p.score += stats.cost;

            const bid = generateId("b");
            STATE.buildings[bid] = {
                id: bid,
                ownerId: p.id,
                clan: p.clan,
                type,
                x: buildX,
                y: buildY,
                hp: stats.hp,
                maxHp: stats.hp,
                lastAttackTick: 0
            };

            if (type === "house") {
                p.maxPop += CONFIG.STATS.house.popBonus;
            }

            if (mineVeinId) {
                STATE.goldVeins[mineVeinId].isOccupied = true;
            }

            socket.emit("actionSuccess", { type: "build" });
        }
    });

    socket.on("sendChat", (msg) => {
        const p = STATE.players[socket.id];
        if (!p || typeof msg !== "string") return;

        const safeMsg = msg.substring(0, 80).replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
        if (!safeMsg) return;

        io.emit("chatMsg", {
            sender: p.clan ? `[${p.clan}] ${p.name}` : p.name,
            msg: safeMsg,
            color: "#ffffff"
        });
    });

    socket.on("disconnect", () => {
        const p = STATE.players[socket.id];
        if (!p) return;

        cleanupOwnedEntities(socket.id);
        delete STATE.players[socket.id];
        console.log("Oyuncu çıktı:", socket.id);
    });
});

setInterval(() => {
    ticks += 1;
// Oyuncu hareketi + altın toplama + can rejen
for (const pid in STATE.players) {
    const p = STATE.players[pid];
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 5) {
        p.x += (dx / dist) * p.speed;
        p.y += (dy / dist) * p.speed;
    }

    p.x = clamp(p.x, p.radius, CONFIG.MAP_SIZE - p.radius);
    p.y = clamp(p.y, p.radius, CONFIG.MAP_SIZE - p.radius);

    // YAVAŞ CAN REJENİ
    if (p.hp < p.maxHp && ticks % 20 === 0) {
        p.hp = Math.min(p.maxHp, p.hp + 4);
    }

    for (const fid in STATE.foods) {
        const f = STATE.foods[fid];
        if (getDist(p.x, p.y, f.x, f.y) < p.radius + 15) {
            const bonusGold = Math.floor(f.val * 3); // 2 kat altın

            p.gold += bonusGold;
            p.score += bonusGold;

            delete STATE.foods[fid];

            // normal yeni altın
            spawnLooseFood();

            // bazen ekstra altın
            if (Math.random() < 0.35) {
                spawnLooseFood();
            }
        }
    }
}

    // Birim hareketi
    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        const owner = STATE.players[u.ownerId];
        if (!owner) {
            delete STATE.units[uid];
            continue;
        }

        const stats = CONFIG.STATS[u.type];
        const targetEnemy = findNearestEnemyForUnit(u);

        let targetX;
        let targetY;

        if (targetEnemy && targetEnemy.dist < stats.range + 220) {
            targetX = targetEnemy.target.x;
            targetY = targetEnemy.target.y;
        } else {
            const formation = getUnitFormationTarget(u, owner);
            targetX = formation.x;
            targetY = formation.y;
        }

        const dx = targetX - u.x;
        const dy = targetY - u.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 6) {
            const moveSpeed = targetEnemy ? stats.speed : stats.speed * 0.9;
            u.x += (dx / dist) * moveSpeed;
            u.y += (dy / dist) * moveSpeed;
        }

        u.x = clamp(u.x, 0, CONFIG.MAP_SIZE);
        u.y = clamp(u.y, 0, CONFIG.MAP_SIZE);
    }

    // Saldırılar
    if (ticks % 2 === 0) {
        for (const uid in STATE.units) {
            const u = STATE.units[uid];
            const stats = CONFIG.STATS[u.type];
            const targetInfo = findNearestEnemyForUnit(u);

            if (!targetInfo) continue;
            if (targetInfo.dist > stats.range) continue;
            if (ticks - u.lastAttackTick < stats.attackDelay) continue;

            u.lastAttackTick = ticks;

            if (u.type === "soldier" || u.type === "knight") {
                damageTarget(targetInfo.target, stats.dmg, u.ownerId);
            } else if (u.type === "archer") {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: targetInfo.id,
                    targetType: targetInfo.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: "arrow",
                    dmg: stats.dmg,
                    speed: 30,
                    radius: 6
                });
            } else if (u.type === "mage") {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: targetInfo.id,
                    targetType: targetInfo.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: "magic",
                    dmg: stats.dmg,
                    speed: 21,
                    radius: 9,
                    splash: 40
                });
            } else if (u.type === "dragon") {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: targetInfo.id,
                    targetType: targetInfo.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: "fireball",
                    dmg: stats.dmg,
                    speed: 18,
                    radius: 12,
                    splash: 70
                });
            }
        }

        for (const bid in STATE.buildings) {
            const b = STATE.buildings[bid];
            if (!["tower", "magetower"].includes(b.type)) continue;

            const stats = CONFIG.STATS[b.type];
            const targetInfo = findNearestEnemyForBuilding(b);
            if (!targetInfo) continue;
            if (ticks - b.lastAttackTick < stats.attackDelay) continue;

            b.lastAttackTick = ticks;

            createProjectile({
                x: b.x,
                y: b.y,
                targetId: targetInfo.id,
                targetType: targetInfo.kind,
                ownerId: b.ownerId,
                clan: b.clan,
                type: b.type === "tower" ? "arrow" : "magic",
                dmg: stats.dmg,
                speed: b.type === "tower" ? 28 : 19,
                radius: b.type === "tower" ? 6 : 10,
                splash: b.type === "tower" ? 0 : 45
            });
        }
    }

    // Projectile güncelleme
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

    // Maden geliri
    if (ticks % CONFIG.MINE_INCOME_INTERVAL_TICKS === 0) {
        for (const bid in STATE.buildings) {
            const b = STATE.buildings[bid];
            if (b.type !== "mine") continue;

            const owner = STATE.players[b.ownerId];
            if (!owner) continue;

            owner.gold += CONFIG.STATS.mine.income;
            owner.score += Math.floor(CONFIG.STATS.mine.income * 0.35);
        }
    }

    io.emit("stateUpdate", {
        state: makePublicState()
    });
}, CONFIG.TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("[BAŞARILI] 6D.IO aktif. Port:", PORT);
});