import express from "express";
import cors from "cors";
import oracledb from "oracledb";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ── 미들웨어 ───────────────────────────────── */
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// 익명 학생 식별 쿠키
app.use((req, res, next) => {
  if (!req.cookies?.studentId) {
    res.cookie("studentId", uuidv4(), {
      httpOnly: false,
      sameSite: "Lax",
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }
  next();
});

// 정적 파일 (프론트)
app.use(express.static(path.join(__dirname, "../frontend")));

// 관리자 키 검사
function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key");
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

/* ── ENV / DB 풀 ─────────────────────────────── */
const {
  DB_USER,
  DB_PASS,
  DB_CONNECT_STRING,
  DB_HOST,
  DB_PORT,
  DB_SERVICE,
} = process.env;

const connectString =
  (DB_CONNECT_STRING && DB_CONNECT_STRING.trim()) ||
  (DB_HOST && DB_PORT && DB_SERVICE ? `${DB_HOST}:${DB_PORT}/${DB_SERVICE}` : "");

if (!DB_USER || !DB_PASS || !connectString) {
  console.error("❌ ENV 설정이 누락되었습니다.", {
    DB_USER,
    DB_PASS: DB_PASS ? "(set)" : "(missing)",
    connectString,
  });
  process.exit(1);
}

let pool;

/* ── 라우트: init() 안에서 등록 (pool 보장) ───── */
async function init() {
  pool = await oracledb.createPool({
    user: DB_USER,
    password: DB_PASS,
    connectString,
  });
  console.log("✅ DB Connected!", { connectString });

  // Health
  app.get("/health", (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // 건의 목록
  app.get("/suggestions", async (req, res) => {
    try {
      const studentId = req.cookies?.studentId || null;
      const conn = await pool.getConnection();
      const result = await conn.execute(
        `SELECT
           ROW_NUMBER() OVER (ORDER BY s.suggestionId) AS displayNo,
           s.suggestionId,
           s.title,
           s.content,
           s.status,
           c.name AS category,
           NVL(vc.cnt, 0) AS voteCount,
           CASE
             WHEN :studentId IS NOT NULL AND EXISTS (
               SELECT 1 FROM Vote v2
                WHERE v2.suggestionId = s.suggestionId
                  AND v2.studentId    = :studentId
             ) THEN 1 ELSE 0
           END AS voted,
           NVL(rc.rcnt, 0) AS replyCount
         FROM Suggestion s
         JOIN Category c ON s.categoryId = c.categoryId
         LEFT JOIN (SELECT suggestionId, COUNT(*) cnt FROM Vote GROUP BY suggestionId) vc
                ON vc.suggestionId = s.suggestionId
         LEFT JOIN (SELECT suggestionId, COUNT(*) rcnt FROM Reply GROUP BY suggestionId) rc
                ON rc.suggestionId = s.suggestionId
         ORDER BY s.suggestionId DESC`,
        { studentId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      await conn.close();
      console.log(`📤 /suggestions -> ${result.rows?.length || 0} rows`);
      res.json(result.rows || []);
    } catch (err) {
      console.error("❌ /suggestions error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 건의 등록
  app.post("/suggestions", async (req, res) => {
    const { title, content, categoryId } = req.body || {};
    if (!title || !content || !categoryId) {
      return res.status(400).json({ error: "title/content/categoryId required" });
    }
    try {
      const conn = await pool.getConnection();
      await conn.execute(
        `INSERT INTO Suggestion (title, content, categoryId)
         VALUES (:t, :c, :cat)`,
        { t: title, c: content, cat: categoryId },
        { autoCommit: true }
      );
      await conn.close();
      console.log("✅ /suggestions insert OK:", { title, categoryId });
      res.json({ message: "ok" });
    } catch (err) {
      console.error("❌ /suggestions insert error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 공감
  app.post("/vote", async (req, res) => {
    const { suggestionId } = req.body || {};
    const studentId = req.cookies?.studentId;
    if (!suggestionId) return res.status(400).json({ error: "suggestionId required" });
    if (!studentId) return res.status(400).json({ error: "studentId cookie missing" });
    try {
      const conn = await pool.getConnection();
      await conn.execute(
        `INSERT INTO Vote (voteId, suggestionId, studentId)
         VALUES (SYS_GUID(), :sid, :st)`,
        { sid: suggestionId, st: studentId },
        { autoCommit: true }
      );
      await conn.close();
      res.json({ message: "👍 Vote added" });
    } catch (err) {
      if (String(err.message).includes("ORA-00001")) {
        return res.status(409).json({ error: "이미 공감했습니다." });
      }
      console.error("❌ /vote error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 답변 목록
  app.get("/replies/:sid", async (req, res) => {
    const sid = Number(req.params.sid);
    try {
      const conn = await pool.getConnection();
      const result = await conn.execute(
        `SELECT replyId, suggestionId, content, repliedAt
           FROM Reply
          WHERE suggestionId = :sid
          ORDER BY repliedAt ASC`,
        { sid },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      await conn.close();
      res.json(result.rows);
    } catch (err) {
      console.error("❌ /replies GET error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 답변 등록(관리자)
  app.post("/replies", requireAdmin, async (req, res) => {
    const { suggestionId, content } = req.body || {};
    if (!suggestionId || !content?.trim()) {
      return res.status(400).json({ error: "suggestionId/content required" });
    }
    try {
      const conn = await pool.getConnection();
      await conn.execute(
        `INSERT INTO Reply (replyId, suggestionId, content)
         VALUES (SYS_GUID(), :sid, :ct)`,
        { sid: suggestionId, ct: content.trim() },
        { autoCommit: true }
      );
      await conn.close();
      res.json({ message: "✅ Reply added" });
    } catch (err) {
      console.error("❌ /replies POST error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 루트 → index.html
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
  });
  
  app.post("/admin/login", (req, res) => {
    const { id, pw } = req.body || {};
    if (id === process.env.ADMIN_ID && pw === process.env.ADMIN_PASS) {
      return res.json({ adminKey: process.env.ADMIN_KEY });
    }
    return res.status(401).json({ error: "로그인 실패" });
  });

  app.listen(4000, () => {
    console.log("🚀 Server running on http://localhost:4000");
  });
}

init().catch((e) => {
  console.error("❌ Failed to init:", e);
  process.exit(1);
});


// ✅ 공감 취소
app.delete("/vote", async (req, res) => {
  const { suggestionId } = req.body || {};
  const studentId = req.cookies.studentId;

  if (!suggestionId || !studentId) {
    return res.status(400).json({ error: "suggestionId / studentId required" });
  }

  try {
    const conn = await pool.getConnection();
    const result = await conn.execute(
      `DELETE FROM Vote WHERE suggestionId = :sid AND studentId = :st`,
      { sid: suggestionId, st: studentId },
      { autoCommit: true }
    );
    await conn.close();
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "아직 공감하지 않았습니다." });
    }
    res.json({ message: "👎 공감 취소됨" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


