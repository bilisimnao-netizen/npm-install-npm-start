const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const CONFIG = {
    MAP_SIZE: 10000,
    TICK_RATE: 1000 / 40,
    MAX_LOOSE_FOOD: 2500,
    GOLD_VEIN_COUNT: 18,
    ENV_COUNT: 120,

    STATS: {
        lord: { hp: 1000, maxHp: 1000, speed: 12, radius: 40 },

        house:     { hp: 500,  cost: 250,  radius: 40, popBonus: 10 },
        tower:     { hp: 1200, cost: 250,  radius: 45, dmg: 15, range: 420, attackDelay: 36 },
        mine:      { hp: 800,  cost: 500,  radius: 50, income: 20 },
        magetower: { hp: 1500, cost: 1500, radius: 45, dmg: 38, range: 520, attackDelay: 54 },

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
    buildings: {},
    foods: {},
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

function getDist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function broadcastSystemMessage(msg, color = '#ffffff', extra = {}) {
    io.emit('chatMsg', { sender: 'SİSTEM', msg, color, ...extra });
}

function isSameClan(aClan, bClan) {
    return aClan && bClan && aClan === bClan;
}

function canAttack(attackerClan, targetClan, attackerOwnerId, targetOwnerId) {
    if (attackerOwnerId === targetOwnerId) return false;
    if (isSameClan(attackerClan, targetClan)) return false;
    return true;
}

function spawnLooseFood(x = null, y = null, val = null) {
    const id = generateId('f');
    STATE.foods[id] = {
        id,
        x: x ?? rand(25, CONFIG.MAP_SIZE - 25),
        y: y ?? rand(25, CONFIG.MAP_SIZE - 25),
        val: val ?? (Math.random() > 0.9 ? 15 : 3)
    };
}

function createProjectile({ x, y, targetId, targetType, ownerId, clan, type, dmg, speed = 22, radius = 8, splash = 0 }) {
    const id = generateId('prj');

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

function cleanupOwnedEntities(ownerId) {
    for (const uid in STATE.units) {
        if (STATE.units[uid].ownerId === ownerId) delete STATE.units[uid];
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (b.ownerId !== ownerId) continue;

        if (b.type === 'mine') {
            for (const vId in STATE.goldVeins) {
                const vein = STATE.goldVeins[vId];
                if (getDist(vein.x, vein.y, b.x, b.y) < vein.radius + 20) vein.isOccupied = false;
            }
        }

        delete STATE.buildings[bid];
    }

    for (const pid in STATE.projectiles) {
        if (STATE.projectiles[pid].ownerId === ownerId) delete STATE.projectiles[pid];
    }
}

function awardScore(ownerId, amount) {
    const p = STATE.players[ownerId];
    if (p) p.score += amount;
}

function killPlayer(playerId, killerName = null) {
    const player = STATE.players[playerId];
    if (!player) return;

    const deadName = player.clan ? `[${player.clan}] ${player.name}` : player.name;
    const text = killerName
        ? `☠️ ${deadName}, ${killerName} tarafından yok edildi!`
        : `☠️ ${deadName} katledildi!`;

    broadcastSystemMessage(text, '#e74c3c', { isKillFeed: true });

    const lootAmount = Math.min(24, Math.max(8, Math.floor(player.gold / 40)));
    for (let i = 0; i < lootAmount; i++) {
        spawnLooseFood(
            clamp(player.x + rand(-120, 120), 25, CONFIG.MAP_SIZE - 25),
            clamp(player.y + rand(-120, 120), 25, CONFIG.MAP_SIZE - 25),
            20
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
        awardScore(attackerOwnerId, 500);
        const killer = STATE.players[attackerOwnerId];
        const killerName = killer ? (killer.clan ? `[${killer.clan}] ${killer.name}` : killer.name) : null;
        killPlayer(targetObj.id, killerName);
        return;
    }

    if (STATE.units[targetObj.id]) {
        const dead = STATE.units[targetObj.id];
        awardScore(attackerOwnerId, CONFIG.STATS[dead.type].cost || 10);

        const owner = STATE.players[dead.ownerId];
        if (owner) owner.population = Math.max(0, owner.population - 1);

        delete STATE.units[targetObj.id];
        return;
    }

    if (STATE.buildings[targetObj.id]) {
        const dead = STATE.buildings[targetObj.id];
        awardScore(attackerOwnerId, CONFIG.STATS[dead.type].cost || 100);

        if (dead.type === 'house') {
            const owner = STATE.players[dead.ownerId];
            if (owner) {
                owner.maxPop = Math.max(10, owner.maxPop - CONFIG.STATS.house.popBonus);
                if (owner.population > owner.maxPop) owner.population = owner.maxPop;
            }
        }

        if (dead.type === 'mine') {
            for (const vId in STATE.goldVeins) {
                const vein = STATE.goldVeins[vId];
                if (getDist(vein.x, vein.y, dead.x, dead.y) < vein.radius + 20) vein.isOccupied = false;
            }
        }

        delete STATE.buildings[targetObj.id];
    }
}

function applySplashDamage(projectile, centerX, centerY) {
    if (!projectile.splash || projectile.splash <= 0) return;

    for (const pid in STATE.players) {
        const p = STATE.players[pid];
        if (!canAttack(projectile.clan, p.clan, projectile.ownerId, p.id)) continue;

        const d = getDist(centerX, centerY, p.x, p.y);
        if (d <= projectile.splash) {
            damageTarget(p, Math.floor(projectile.dmg * 0.55), projectile.ownerId);
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        if (!canAttack(projectile.clan, u.clan, projectile.ownerId, u.ownerId)) continue;

        const d = getDist(centerX, centerY, u.x, u.y);
        if (d <= projectile.splash) {
            damageTarget(u, Math.floor(projectile.dmg * 0.55), projectile.ownerId);
        }
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (!canAttack(projectile.clan, b.clan, projectile.ownerId, b.ownerId)) continue;

        const d = getDist(centerX, centerY, b.x, b.y);
        if (d <= projectile.splash) {
            damageTarget(b, Math.floor(projectile.dmg * 0.45), projectile.ownerId);
        }
    }
}

function findNearestEnemyForUnit(unit) {
    let best = null;
    let bestDist = Infinity;

    for (const pid in STATE.players) {
        const p = STATE.players[pid];
        if (!canAttack(unit.clan, p.clan, unit.ownerId, p.id)) continue;
        const d = getDist(unit.x, unit.y, p.x, p.y);
        if (d < bestDist) {
            bestDist = d;
            best = { kind: 'player', id: p.id, target: p, dist: d };
        }
    }

    for (const uid in STATE.units) {
        const other = STATE.units[uid];
        if (other.id === unit.id) continue;
        if (!canAttack(unit.clan, other.clan, unit.ownerId, other.ownerId)) continue;
        const d = getDist(unit.x, unit.y, other.x, other.y);
        if (d < bestDist) {
            bestDist = d;
            best = { kind: 'unit', id: other.id, target: other, dist: d };
        }
    }

    for (const bid in STATE.buildings) {
        const b = STATE.buildings[bid];
        if (!canAttack(unit.clan, b.clan, unit.ownerId, b.ownerId)) continue;
        const d = getDist(unit.x, unit.y, b.x, b.y);
        if (d < bestDist) {
            bestDist = d;
            best = { kind: 'building', id: b.id, target: b, dist: d };
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
        if (!canAttack(building.clan, p.clan, building.ownerId, p.id)) continue;
        const d = getDist(building.x, building.y, p.x, p.y);
        if (d <= stats.range && d < bestDist) {
            bestDist = d;
            best = { kind: 'player', id: p.id, target: p, dist: d };
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        if (!canAttack(building.clan, u.clan, building.ownerId, u.ownerId)) continue;
        const d = getDist(building.x, building.y, u.x, u.y);
        if (d <= stats.range && d < bestDist) {
            bestDist = d;
            best = { kind: 'unit', id: u.id, target: u, dist: d };
        }
    }

    return best;
}

function initWorld() {
    console.log('[SİSTEM] Dünya oluşturuluyor...');

    for (let i = 0; i < CONFIG.ENV_COUNT; i++) {
        const id = `env_${i}`;
        STATE.envs[id] = {
            id,
            x: rand(100, CONFIG.MAP_SIZE - 100),
            y: rand(100, CONFIG.MAP_SIZE - 100),
            type: Math.random() > 0.6 ? 'tree' : 'rock',
            radius: rand(50, 90)
        };
    }

    for (let i = 0; i < CONFIG.GOLD_VEIN_COUNT; i++) {
        const id = generateId('vein');
        STATE.goldVeins[id] = {
            id,
            x: rand(200, CONFIG.MAP_SIZE - 200),
            y: rand(200, CONFIG.MAP_SIZE - 200),
            radius: 80,
            isOccupied: false
        };
    }

    for (let i = 0; i < CONFIG.MAX_LOOSE_FOOD; i++) spawnLooseFood();
    console.log(`[SİSTEM] Dünya hazır. ${CONFIG.GOLD_VEIN_COUNT} altın damarı oluşturuldu.`);
}

initWorld();

io.on('connection', (socket) => {
    console.log(`[BAĞLANTI] Yeni oyuncu bağlandı: ${socket.id}`);

    socket.on('joinGame', (data) => {
        const clanStr = String(data?.clan || '').trim().toUpperCase().substring(0, 6);
        const playerName = String(data?.name || 'İsimsiz Lord').trim().substring(0, 15) || 'İsimsiz Lord';
        const charType = ['recep', 'togg', 'bez'].includes(data?.charType) ? data.charType : 'recep';

        STATE.players[socket.id] = {
            id: socket.id,
            name: playerName,
            clan: clanStr,
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

        socket.emit('init', {
            id: socket.id,
            mapSize: CONFIG.MAP_SIZE,
            state: STATE
        });

        const joinedName = clanStr ? `[${clanStr}] ${playerName}` : playerName;
        broadcastSystemMessage(`${joinedName} savaşa katıldı!`, '#2ecc71');
    });

    socket.on('mouseUpdate', (pos) => {
        const p = STATE.players[socket.id];
        if (!p) return;

        if (typeof pos?.x === 'number' && typeof pos?.y === 'number') {
            p.targetX = clamp(pos.x, 0, CONFIG.MAP_SIZE);
            p.targetY = clamp(pos.y, 0, CONFIG.MAP_SIZE);
        }
    });

    socket.on('buy', (type) => {
        const p = STATE.players[socket.id];
        if (!p || !CONFIG.STATS[type]) return;

        const cost = CONFIG.STATS[type].cost;
        if (p.gold < cost) {
            socket.emit('systemAlert', 'Yetersiz altın!');
            return;
        }

        if (['house', 'tower', 'mine', 'magetower'].includes(type)) {
            for (const bid in STATE.buildings) {
                const b = STATE.buildings[bid];
                if (getDist(b.x, b.y, p.x, p.y) < 100) {
                    socket.emit('systemAlert', 'Buraya çok yakın başka bina var!');
                    return;
                }
            }

            if (type === 'mine') {
                let targetVeinId = null;

                for (const vId in STATE.goldVeins) {
                    const vein = STATE.goldVeins[vId];
                    if (!vein.isOccupied && getDist(p.x, p.y, vein.x, vein.y) < vein.radius + 20) {
                        targetVeinId = vId;
                        break;
                    }
                }

                if (!targetVeinId) {
                    socket.emit('systemAlert', 'Maden sadece Altın Damarı üzerine kurulabilir!');
                    return;
                }

                STATE.goldVeins[targetVeinId].isOccupied = true;
            }

            p.gold -= cost;
            p.score += cost;

            const bId = generateId('b');
            STATE.buildings[bId] = {
                id: bId,
                ownerId: p.id,
                clan: p.clan,
                type,
                x: p.x,
                y: p.y,
                hp: CONFIG.STATS[type].hp,
                maxHp: CONFIG.STATS[type].hp,
                lastAttackTick: 0
            };

            if (type === 'house') p.maxPop += CONFIG.STATS.house.popBonus;
            socket.emit('actionSuccess', { type: 'build' });
            return;
        }

        if (['soldier', 'knight', 'archer', 'mage', 'dragon'].includes(type)) {
            if (p.population >= p.maxPop) {
                socket.emit('systemAlert', 'Ordu sınırına ulaştın! Daha fazla ev inşa et.');
                return;
            }

            p.gold -= cost;
            p.score += cost;
            p.population += 1;

            const unitId = generateId('u');
            STATE.units[unitId] = {
                id: unitId,
                ownerId: p.id,
                clan: p.clan,
                type,
                x: clamp(p.x + rand(-40, 40), 0, CONFIG.MAP_SIZE),
                y: clamp(p.y + rand(-40, 40), 0, CONFIG.MAP_SIZE),
                hp: CONFIG.STATS[type].hp,
                maxHp: CONFIG.STATS[type].hp,
                lastAttackTick: 0
            };

            socket.emit('actionSuccess', { type: 'spawn' });
        }
    });

    socket.on('sendChat', (msg) => {
        const p = STATE.players[socket.id];
        if (!p || typeof msg !== 'string') return;

        const safeMsg = msg.substring(0, 80).replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
        if (!safeMsg) return;

        const sender = p.clan ? `[${p.clan}] ${p.name}` : p.name;
        io.emit('chatMsg', { sender, msg: safeMsg, color: '#ffffff' });
    });

    socket.on('disconnect', () => {
        console.log(`[BAĞLANTI KOPTU] ${socket.id}`);

        const p = STATE.players[socket.id];
        if (!p) return;

        const leftName = p.clan ? `[${p.clan}] ${p.name}` : p.name;
        cleanupOwnedEntities(socket.id);
        delete STATE.players[socket.id];
        broadcastSystemMessage(`${leftName} savaşı terk etti.`, '#95a5a6');
    });
});

setInterval(() => {
    ticks++;

    for (const id in STATE.players) {
        const p = STATE.players[id];
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 5) {
            p.x += (dx / dist) * p.speed;
            p.y += (dy / dist) * p.speed;
        }

        p.x = clamp(p.x, p.radius, CONFIG.MAP_SIZE - p.radius);
        p.y = clamp(p.y, p.radius, CONFIG.MAP_SIZE - p.radius);

        for (const fId in STATE.foods) {
            const f = STATE.foods[fId];
            if (getDist(p.x, p.y, f.x, f.y) < p.radius + 15) {
                p.gold += f.val;
                p.score += f.val;
                delete STATE.foods[fId];
                spawnLooseFood();
            }
        }
    }

    for (const uid in STATE.units) {
        const u = STATE.units[uid];
        const owner = STATE.players[u.ownerId];
        if (!owner) {
            delete STATE.units[uid];
            continue;
        }

        const stats = CONFIG.STATS[u.type];
        const targetEnemy = findNearestEnemyForUnit(u);

        if (targetEnemy && targetEnemy.dist < stats.range * 1.3) {
            const dx = targetEnemy.target.x - u.x;
            const dy = targetEnemy.target.y - u.y;
            const dist = Math.max(1, Math.hypot(dx, dy));

            if (dist > stats.range * 0.85) {
                u.x += (dx / dist) * stats.speed;
                u.y += (dy / dist) * stats.speed;
            }
        } else {
            const dx = owner.x - u.x;
            const dy = owner.y - u.y;
            const dist = Math.hypot(dx, dy);

            if (dist > 120) {
                u.x += (dx / dist) * stats.speed;
                u.y += (dy / dist) * stats.speed;
            }
        }

        for (const otherId in STATE.units) {
            if (otherId === uid) continue;
            const other = STATE.units[otherId];
            const sepDist = getDist(u.x, u.y, other.x, other.y);
            if (sepDist > 0 && sepDist < stats.radius * 1.6) {
                u.x += ((u.x - other.x) / sepDist) * 2.2;
                u.y += ((u.y - other.y) / sepDist) * 2.2;
            }
        }

        u.x = clamp(u.x, 0, CONFIG.MAP_SIZE);
        u.y = clamp(u.y, 0, CONFIG.MAP_SIZE);
    }

    if (ticks % 2 === 0) {
        for (const uid in STATE.units) {
            const u = STATE.units[uid];
            if (!u) continue;

            const stats = CONFIG.STATS[u.type];
            const targetInfo = findNearestEnemyForUnit(u);
            if (!targetInfo) continue;
            if (targetInfo.dist > stats.range) continue;
            if (ticks - u.lastAttackTick < stats.attackDelay) continue;

            u.lastAttackTick = ticks;

            if (u.type === 'soldier' || u.type === 'knight') {
                damageTarget(targetInfo.target, stats.dmg, u.ownerId);
            } else if (u.type === 'archer') {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: targetInfo.id,
                    targetType: targetInfo.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: 'arrow',
                    dmg: stats.dmg,
                    speed: 30,
                    radius: 6
                });
            } else if (u.type === 'mage') {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: targetInfo.id,
                    targetType: targetInfo.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: 'magic',
                    dmg: stats.dmg,
                    speed: 21,
                    radius: 9,
                    splash: 40
                });
            } else if (u.type === 'dragon') {
                createProjectile({
                    x: u.x,
                    y: u.y,
                    targetId: targetInfo.id,
                    targetType: targetInfo.kind,
                    ownerId: u.ownerId,
                    clan: u.clan,
                    type: 'fireball',
                    dmg: stats.dmg,
                    speed: 18,
                    radius: 12,
                    splash: 70
                });
            }
        }

        for (const bid in STATE.buildings) {
            const b = STATE.buildings[bid];
            if (!b || !['tower', 'magetower'].includes(b.type)) continue;

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
                type: b.type === 'tower' ? 'arrow' : 'magic',
                dmg: stats.dmg,
                speed: b.type === 'tower' ? 28 : 19,
                radius: b.type === 'tower' ? 6 : 10,
                splash: b.type === 'tower' ? 0 : 45
            });
        }
    }

    for (const pid in STATE.projectiles) {
        const prj = STATE.projectiles[pid];

        let target = null;
        if (prj.targetType === 'player') target = STATE.players[prj.targetId];
        else if (prj.targetType === 'unit') target = STATE.units[prj.targetId];
        else if (prj.targetType === 'building') target = STATE.buildings[prj.targetId];

        if (!target) {
            delete STATE.projectiles[pid];
            continue;
        }

        const dx = target.x - prj.x;
        const dy = target.y - prj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= prj.radius + 12) {
            damageTarget(target, prj.dmg, prj.ownerId);

            if (prj.type === 'magic' || prj.type === 'fireball') {
                applySplashDamage(prj, target.x, target.y);
            }

            delete STATE.projectiles[pid];
            continue;
        }

        if (dist > 0) {
            prj.x += (dx / dist) * prj.speed;
            prj.y += (dy / dist) * prj.speed;
        }

        prj.life--;
        if (prj.life <= 0) delete STATE.projectiles[pid];
    }

    if (ticks % 40 === 0) {
        for (const bid in STATE.buildings) {
            const b = STATE.buildings[bid];
            if (b.type !== 'mine') continue;

            const owner = STATE.players[b.ownerId];
            if (owner) {
                owner.gold += CONFIG.STATS.mine.income;
                owner.score += Math.floor(CONFIG.STATS.mine.income * 0.35);
            }
        }
    }

    io.emit('stateUpdate', { state: STATE });

}, CONFIG.TICK_RATE);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`[BAŞARILI] 6D.IO aktif. Port: ${PORT}`);
});