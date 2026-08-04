const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const pool = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const courseService = require('./course.service');

// Direct implementation of pseudocode 4.9.6: join Sessions + Enrolments + AttendanceRecords
// so absentees are surfaced (not just who showed up), fulfilling FR13/FR14.
async function generateAttendanceReport({ courseId, dateRangeStart, dateRangeEnd, requester }) {
  const course = await courseService.getCourseById(courseId);
  if (requester.role === 'teacher' && course.teacher_id !== requester.id) {
    throw new ApiError(403, 'You do not own this course');
  }

  const [sessions] = await pool.query(
    `SELECT id, start_time, end_time FROM sessions
     WHERE course_id = ? AND start_time BETWEEN ? AND ?
     ORDER BY start_time`,
    [courseId, dateRangeStart, dateRangeEnd]
  );

  const [enrolled] = await pool.query(
    `SELECT u.id AS student_id, u.name, s.student_number
     FROM enrolments e
     JOIN users u ON u.id = e.student_id
     JOIN students s ON s.user_id = u.id
     WHERE e.course_id = ?
     ORDER BY u.name`,
    [courseId]
  );

  const [records] = await pool.query(
    `SELECT session_id, student_id, submitted_at
     FROM attendance_records
     WHERE session_id IN (${sessions.map(() => '?').join(',') || 'NULL'})`,
    sessions.map((s) => s.id)
  );
  const presentSet = new Set(records.map((r) => `${r.session_id}:${r.student_id}`));

  const detail = [];
  for (const session of sessions) {
    for (const student of enrolled) {
      const present = presentSet.has(`${session.id}:${student.student_id}`);
      detail.push({
        sessionId: session.id,
        sessionDate: session.start_time,
        studentId: student.student_id,
        studentName: student.name,
        studentNumber: student.student_number,
        status: present ? 'PRESENT' : 'ABSENT',
      });
    }
  }

  const summaryMap = new Map();
  for (const student of enrolled) {
    summaryMap.set(student.student_id, {
      studentId: student.student_id,
      studentName: student.name,
      studentNumber: student.student_number,
      presentCount: 0,
      totalSessions: sessions.length,
    });
  }
  for (const row of detail) {
    if (row.status === 'PRESENT') {
      summaryMap.get(row.studentId).presentCount += 1;
    }
  }
  const summary = [...summaryMap.values()].map((s) => ({
    ...s,
    attendancePercentage:
      s.totalSessions > 0 ? Math.round((s.presentCount / s.totalSessions) * 1000) / 10 : 0,
  }));

  return { course, sessionCount: sessions.length, detail, summary };
}

async function renderReportAsPdf(report) {
  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(16).text(`Attendance Report - ${report.course.course_name} (${report.course.course_code})`);
  doc.moveDown();
  doc.fontSize(11).text(`Sessions in range: ${report.sessionCount}`);
  doc.moveDown();

  doc.fontSize(12).text('Summary', { underline: true });
  report.summary.forEach((row) => {
    doc
      .fontSize(10)
      .text(
        `${row.studentNumber}  ${row.studentName}  -  ${row.presentCount}/${row.totalSessions} (${row.attendancePercentage}%)`
      );
  });

  doc.end();
  return done;
}

async function renderReportAsXlsx(report) {
  const workbook = new ExcelJS.Workbook();
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Student Number', key: 'studentNumber', width: 18 },
    { header: 'Student Name', key: 'studentName', width: 28 },
    { header: 'Present', key: 'presentCount', width: 10 },
    { header: 'Total Sessions', key: 'totalSessions', width: 14 },
    { header: 'Attendance %', key: 'attendancePercentage', width: 14 },
  ];
  summarySheet.addRows(report.summary);

  const detailSheet = workbook.addWorksheet('Detail');
  detailSheet.columns = [
    { header: 'Session Date', key: 'sessionDate', width: 22 },
    { header: 'Student Number', key: 'studentNumber', width: 18 },
    { header: 'Student Name', key: 'studentName', width: 28 },
    { header: 'Status', key: 'status', width: 10 },
  ];
  detailSheet.addRows(report.detail);

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateAttendanceReport, renderReportAsPdf, renderReportAsXlsx };
