const API = ""; // 같은 도메인(4000)에서 정적서빙하므로 prefix 불필요

// 목록 렌더
async function loadSuggestions(bust = false) {
  const listEl = document.getElementById("suggestList");
  listEl.innerHTML = `<div class="item">불러오는 중…</div>`;
  try {
    const res = await fetch(`/suggestions${bust ? `?t=${Date.now()}` : ""}`);
    const rows = await res.json();

    listEl.innerHTML = "";
    if (!Array.isArray(rows) || rows.length === 0) {
      listEl.innerHTML = `<div class="item" style="color:#6b7280">등록된 건의가 없습니다.</div>`;
      return;
    }

    rows.forEach(r => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="title">${r.DISPLAYNO}. ${escapeHtml(r.TITLE)}</div>
        <div>${escapeHtml(r.CONTENT)}</div>
        <div class="meta">
          <span>카테고리: ${escapeHtml(r.CATEGORY)}</span>
          <span>상태: ${escapeHtml(r.STATUS)}</span>
          <button class="vote" data-id="${r.SUGGESTIONID}" ${r.VOTED === 1 ? "disabled" : ""}>
            👍 공감 <span class="vc">${r.VOTECOUNT ?? 0}</span>
          </button>
          <button class="replies" data-id="${r.SUGGESTIONID}">
            💬 답변 ${r.REPLYCOUNT ?? 0}
          </button>
        </div>
      `;
      listEl.appendChild(div);
    });

    bindVoteButtons();
    bindReplyButtons();
    // replies 버튼은 다음 단계에서 이어서 구현
  } catch (e) {
    listEl.innerHTML = `<div class="item" style="color:#ef4444">목록 로드 실패: ${e.message}</div>`;
    console.error(e);
  }
}

// 등록
document.getElementById("suggestForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("title").value.trim();
  const content = document.getElementById("content").value.trim();
  const categoryId = document.getElementById("categoryId").value;

  if (!title || !content || !categoryId) return; // 브라우저 required가 막아줌

  try {
    const r = await fetch("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, categoryId }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);

    // 폼 리셋 및 목록 새로고침(캐시 무력화)
    e.target.reset();
    await loadSuggestions(true);
  } catch (err) {
    alert("등록 실패: " + err.message);
    console.error(err);
  }
});

// 공감
function bindVoteButtons() {
  document.querySelectorAll(".vote").forEach(btn => {
    btn.onclick = async () => {
      const sid = Number(btn.dataset.id);
      const liked = btn.classList.contains("liked");

      try {
        const r = await fetch("/vote", {
          method: liked ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suggestionId: sid })
        });

        const body = await r.json().catch(()=>({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);

        const span = btn.querySelector(".vc");
        span.textContent = liked
          ? Number(span.textContent) - 1
          : Number(span.textContent) + 1;

        btn.classList.toggle("liked", !liked);
      } catch(e){
        alert("공감 오류: "+e.message);
      }
    };
  });
}

function bindReplyButtons() {
  document.querySelectorAll(".replies").forEach(btn => {
    btn.onclick = async () => {
      const sid = Number(btn.dataset.id);
      const box = btn.closest(".item");

      // 이미 펼쳐져 있으면 접기
      const exists = box.querySelector(".replyBox");
      if (exists) {
        exists.remove();
        return;
      }

      // 새 박스 생성
      const replyBox = document.createElement("div");
      replyBox.className = "replyBox";
      replyBox.style = "margin-top:10px; padding-left:12px; border-left:3px solid #3b82f6;";

      replyBox.innerHTML = `<div style="color:#6b7280">불러오는 중...</div>`;
      box.appendChild(replyBox);

      // 답변 불러오기
      try {
        const res = await fetch(`/replies/${sid}`);
        const rows = await res.json();

        if (!rows.length) {
          replyBox.innerHTML = `<div style="color:#6b7280">아직 답변이 없습니다.</div>`;
        } else {
          replyBox.innerHTML = rows.map(r =>
            `<div style="margin-bottom:6px;">
              <b>교사:</b> ${escapeHtml(r.CONTENT)}
              <div style="font-size:12px; color:#6b7280">${r.REPLIEDAT}</div>
            </div>`
          ).join("");
        }
      } catch {
        replyBox.innerHTML = `<div style="color:#ef4444">답변 불러오기 실패</div>`;
      }

      // 👉 관리자일 때만 입력창 보이기
      if (localStorage.getItem("admin") === "1") {
        replyBox.innerHTML += `
          <textarea class="replyInput" rows="2" style="width:100%; margin-top:6px;" placeholder="답변 입력..."></textarea>
          <button class="replySend" data-id="${sid}" style="margin-top:4px;">답변 등록</button>
        `;

        replyBox.querySelector(".replySend").onclick = async () => {
          const text = replyBox.querySelector(".replyInput").value.trim();
          if (!text) return;

          const r = await fetch("/replies", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-key": localStorage.getItem("adminKey") || ""
            },
            body: JSON.stringify({ suggestionId: sid, content: text })
          });


          if (!r.ok) return alert("등록 실패 (관리자 키 확인)");

          loadSuggestions(true);
        };
      }
    };
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

// 처음 진입 시 자동 로드
window.addEventListener("DOMContentLoaded", () => loadSuggestions(true));
document.getElementById("adminBtn")?.addEventListener("click", () => {
  location.href = "/admin.html";
});


// 관리자 로그인 여부에 따라 버튼 표시
function refreshAdminUI() {
  const isAdmin = localStorage.getItem("admin") === "1";
  document.getElementById("logoutBtn").style.display = isAdmin ? "inline-block" : "none";
  document.getElementById("adminBtn").style.display = isAdmin ? "none" : "inline-block";
}

refreshAdminUI();

// 로그아웃 버튼
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem("admin");
  localStorage.removeItem("adminKey");
  alert("로그아웃 되었습니다.");
  refreshAdminUI();
  loadSuggestions(true); // 목록 다시 불러서 답변 버튼 숨기기 반영
});
