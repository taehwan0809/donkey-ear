------------------------------------------------
-- 1) 카테고리 테이블
------------------------------------------------
CREATE TABLE Category (
    categoryId VARCHAR2(50) PRIMARY KEY,
    name       VARCHAR2(50) UNIQUE NOT NULL
);

------------------------------------------------
-- 2) 건의사항 테이블 + 자동 증가 (SEQ + TRIGGER)
------------------------------------------------
CREATE TABLE Suggestion (
    suggestionId NUMBER PRIMARY KEY,
    title        VARCHAR2(100) NOT NULL,
    content      VARCHAR2(1024) NOT NULL,
    categoryId   VARCHAR2(50) NOT NULL,
    createdAt    DATE DEFAULT SYSDATE NOT NULL,
    status       VARCHAR2(20) DEFAULT '대기' CHECK(status IN ('대기','완료')),
    CONSTRAINT fk_suggestion_category
        FOREIGN KEY (categoryId) REFERENCES Category(categoryId)
);

-- 자동 증가 시퀀스
CREATE SEQUENCE seq_suggestion START WITH 1 INCREMENT BY 1;

-- 자동 증가 트리거
CREATE OR REPLACE TRIGGER trg_suggestion_ai
BEFORE INSERT ON Suggestion
FOR EACH ROW
BEGIN
    IF :new.suggestionId IS NULL THEN
        SELECT seq_suggestion.NEXTVAL INTO :new.suggestionId FROM dual;
    END IF;
END;
/

------------------------------------------------
-- 3) 답변 테이블 (건의 삭제 시 자동 삭제)
------------------------------------------------
CREATE TABLE Reply (
    replyId     VARCHAR2(50) PRIMARY KEY,
    suggestionId NUMBER NOT NULL,
    content     VARCHAR2(1024) NOT NULL,
    repliedAt   DATE DEFAULT SYSDATE NOT NULL,
    CONSTRAINT fk_reply_suggestion
        FOREIGN KEY (suggestionId)
        REFERENCES Suggestion(suggestionId)
        ON DELETE CASCADE
);

------------------------------------------------
-- 4) 공감 테이블 (중복 공감 방지)
------------------------------------------------
CREATE TABLE Vote (
    voteId       VARCHAR2(50) PRIMARY KEY,
    suggestionId NUMBER NOT NULL,
    studentId    VARCHAR2(50),
    CONSTRAINT fk_vote_suggestion
        FOREIGN KEY (suggestionId)
        REFERENCES Suggestion(suggestionId)
        ON DELETE CASCADE,
    CONSTRAINT uq_vote UNIQUE (suggestionId, studentId)
);


CREATE SEQUENCE SUGGESTION_SEQ
START WITH 1
INCREMENT BY 1
NOCACHE;

CREATE OR REPLACE TRIGGER SUGGESTION_BI
BEFORE INSERT ON Suggestion
FOR EACH ROW
BEGIN
  :NEW.suggestionId := SUGGESTION_SEQ.NEXTVAL;
END;
/
INSERT INTO Category (categoryId, name) VALUES ('MEAL', '급식');
INSERT INTO Category (categoryId, name) VALUES ('FACILITY', '시설');
INSERT INTO Category (categoryId, name) VALUES ('EVENT', '행사');

COMMIT;

select * from Suggestion;

DELETE FROM Suggestion;