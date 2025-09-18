// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ✅ Serve everything in /public
app.use(express.static(path.join(__dirname, "public")));


const PORT = process.env.PORT || 3000;;

// ===== GAME STATE =====
let gameState = {
    players: {}, // socket.id -> player
    food: { x: 300, y: 300, radius: 10 },
    timerRunning: false
};

function Ballbody(radius, color, smooth) {
    this.x = 100;
    this.y = 100;
    this.radius = radius;
    this.color = color;
    this.smooth = smooth;
}

// ===== UTILS =====
function spawnFood() {
    gameState.food = {
        x: Math.random() * 600 + 20,
        y: Math.random() * 400 + 20,
        radius: 10,
    };
}

function checkFoodCollision(player) {
    const head = player.snakeBody[0];
    const dx = head.x - gameState.food.x;
    const dy = head.y - gameState.food.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < head.radius + gameState.food.radius) {
        player.score += 1;

        // Add new segment at last position
        const lastBall = player.snakeBody[player.snakeBody.length - 1];
        let ballbody = new Ballbody(lastBall.radius, player.color, 0.2);
        // Place new ball directly behind lastBall on X axis (or Y if you prefer)
        ballbody.x = lastBall.x - (2 * lastBall.radius);
        ballbody.y = lastBall.y;
        player.snakeBody.push(ballbody);
        spawnFood();
    }
}

function updateGame() {
    for (const id in gameState.players) {
        const player = gameState.players[id];
        updateSnakeBody(player);
        checkFoodCollision(player);
    }
}

function updateSnakeBody(player) {
    const BALLS = player.snakeBody;
    const smoothVar = 0.2;

    // Move head toward mouse
    BALLS[0].x += (player.mouse.x - BALLS[0].x) * smoothVar;
    BALLS[0].y += (player.mouse.y - BALLS[0].y) * smoothVar;

    // Update rest of the body
    for (let j = 1; j < BALLS.length; j++) {
        const dx = BALLS[j - 1].x - BALLS[j].x;
        const dy = BALLS[j - 1].y - BALLS[j].y;
        const angle = Math.atan2(dy, dx);

        // target position = previous ball center - (spacing * direction)
        const targetX = BALLS[j - 1].x - BALLS[j].radius * 2 * Math.cos(angle);
        const targetY = BALLS[j - 1].y - BALLS[j].radius * 2 * Math.sin(angle);

        BALLS[j].x += (targetX - BALLS[j].x) * smoothVar;
        BALLS[j].y += (targetY - BALLS[j].y) * smoothVar;
    }
}


// ===== SOCKET EVENTS =====
io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);
    if (io.sockets.sockets.size > 3) {
        return;
    }

    socket.on("playerReady", () => {
        const player = gameState.players[socket.id];
        if (player) {
            player.ready = true;
            console.log(`Player ${socket.id} is ready`);
            checkAllPlayersReady();
        }
    });
    // Create new player
    gameState.players[socket.id] = {
        id: socket.id,
        snakeBody: [new Ballbody(15, getRandomColor(), 0.2)],
        score: 0,
        mouse: { x: 0, y: 0 },
        ready: false
    };

    // Send initial state
    socket.emit("init", gameState);

    // Update mouse
    socket.on("updateMouse", (mouse) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.mouse.x = mouse.x;
            player.mouse.y = mouse.y
            checkFoodCollision(player);
        }
    });

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);
        delete gameState.players[socket.id];
    });
});



function checkAllPlayersReady() {
    const players = Object.values(gameState.players);
    if (players.length === 0) return;

    const allReady = players.every(p => p.ready);
    if (allReady && !gameState.timerRunning) {

        startCountdown();
    }
}

function startCountdown() {
    let countdown = 5;
    gameState.timerRunning = true;

    const interval = setInterval(() => {
        io.emit("countdown", countdown);
        console.log("Countdown:", countdown);

        if (countdown <= 0) {
            clearInterval(interval);

            // Reset players for new round
            Object.values(gameState.players).forEach(p => {
                p.score = 0;
                // Give a fresh snake with only the head
                p.snakeBody = [new Ballbody(15, p.color, 0.2)];
                p.ready = false; // optional: reset ready state
            });

            io.emit("gameStart");
            console.log("Game started!");
            startGameTimer();
        }

        countdown--;
    }, 1000);
}

function startGameTimer() {
    let timeLeft = 60;

    const gameInterval = setInterval(() => {
        io.emit("timerUpdate", timeLeft);

        if (timeLeft <= 0) {
            clearInterval(gameInterval);

            // Send final scores
            const scores = Object.values(gameState.players).map(p => ({
                id: p.id,
                score: p.score,
            }));

            io.emit("gameOver", scores);

            // Reset for next round
            gameState.timerRunning = false;
            Object.values(gameState.players).forEach(p => (p.ready = false));
        }

        timeLeft--;
    }, 1000);
}


// Broadcast game state to all clients
setInterval(() => {
    updateGame();
    io.emit("stateUpdate", buildStateUpdate());
}, 1000 / 15);


server.listen(PORT, () =>
    console.log(`Server running at ${process.env.CLIENT_URL}:${PORT}`)
);


// ===== HELPERS =====
function getRandomColor() {
    const colors = ["red", "blue", "green", "purple", "orange"];
    return colors[Math.floor(Math.random() * colors.length)];
}

function buildStateUpdate() {
    return {
        players: Object.values(gameState.players).map(p => ({
            id: p.id,
            head: { x: p.snakeBody[0].x, y: p.snakeBody[0].y }, // only head position
            score: p.score,
            color: p.snakeBody[0].color
        })),
        food: gameState.food
    };
}


