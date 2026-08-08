-- courses.teacher_id pointed at users(id), so the database would happily accept a student's
-- id as the owner of a course - nothing but application discipline stood in the way. Pointing
-- it at teachers(user_id) makes "a course is owned by a teacher" an invariant the database
-- enforces, which is the whole reason the teachers table exists.
--
-- Only this one foreign key is repointed. enrolments.student_id and
-- attendance_records.student_id are left on users(id) on purpose: admin role changes DELETE
-- the old detail row, so a students(user_id) reference would cascade and silently destroy a
-- student's attendance history the moment an admin corrected their role.

-- Any pre-existing row that would violate the new constraint is released rather than
-- blocking the migration; the FK below already treats a missing teacher as NULL.
UPDATE courses
   SET teacher_id = NULL
 WHERE teacher_id IS NOT NULL
   AND teacher_id NOT IN (SELECT user_id FROM teachers);

ALTER TABLE courses DROP FOREIGN KEY fk_courses_teacher;

ALTER TABLE courses
  ADD CONSTRAINT fk_courses_teacher
  FOREIGN KEY (teacher_id) REFERENCES teachers(user_id) ON DELETE SET NULL;
