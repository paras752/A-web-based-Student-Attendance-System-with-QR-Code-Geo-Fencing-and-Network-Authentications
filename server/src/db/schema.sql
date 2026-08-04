-- Smart Student Attendance System (SSAS) schema
-- Run against MySQL 8.0 (matches Section 3.2.6 / Table 4.1 / Figure 4.5 of the capstone report).

CREATE DATABASE IF NOT EXISTS ssas
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE ssas;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS attendance_records;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(100)  NOT NULL,
  role          ENUM('student', 'teacher', 'admin') NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE students (
  user_id         INT PRIMARY KEY,
  student_number  VARCHAR(40) NOT NULL UNIQUE,
  program         VARCHAR(100),
  semester        VARCHAR(20),
  section         VARCHAR(20),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE teachers (
  user_id      INT PRIMARY KEY,
  department   VARCHAR(100),
  designation  VARCHAR(100),
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE courses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  course_name   VARCHAR(150) NOT NULL,
  course_code   VARCHAR(30)  NOT NULL UNIQUE,
  teacher_id    INT NULL,
  credit_hours  INT NOT NULL DEFAULT 3,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_courses_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE enrolments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_id      INT NOT NULL,
  course_id       INT NOT NULL,
  enrolment_date  DATE NOT NULL DEFAULT (CURRENT_DATE),
  CONSTRAINT fk_enrolments_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrolments_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY uq_enrolment (student_id, course_id)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  course_id          INT NOT NULL,
  qr_secret          VARCHAR(128) NOT NULL,
  geofence_lat       DECIMAL(9,6) NOT NULL,
  geofence_lng       DECIMAL(9,6) NOT NULL,
  geofence_radius_m  INT NOT NULL DEFAULT 50,
  authorised_ssid    VARCHAR(64) NULL,
  authorised_subnet  VARCHAR(64) NOT NULL,
  start_time         DATETIME NOT NULL,
  end_time           DATETIME NOT NULL,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  INDEX idx_sessions_course (course_id)
) ENGINE=InnoDB;

CREATE TABLE attendance_records (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  session_id             INT NOT NULL,
  student_id             INT NOT NULL,
  qr_check_passed        TINYINT(1) NOT NULL,
  geofence_check_passed  TINYINT(1) NOT NULL,
  network_check_passed   TINYINT(1) NOT NULL,
  distance_meters        DECIMAL(10,2) NULL,
  device_fingerprint     VARCHAR(128) NULL,
  submitted_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_session_student (session_id, student_id),
  INDEX idx_attendance_student (student_id)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token_hash  VARCHAR(128) NOT NULL,
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_refresh_user (user_id)
) ENGINE=InnoDB;
