const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const reportService = require('../services/report.service');

const courseReport = asyncHandler(async (req, res) => {
  const { courseId, from, to, format } = req.query;
  if (!courseId || !from || !to) {
    throw new ApiError(400, 'courseId, from, and to query parameters are required');
  }

  const report = await reportService.generateAttendanceReport({
    courseId: Number(courseId),
    dateRangeStart: from,
    dateRangeEnd: to,
    requester: req.user,
  });

  if (format === 'pdf') {
    const buffer = await reportService.renderReportAsPdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${courseId}.pdf"`);
    return res.send(buffer);
  }

  if (format === 'xlsx') {
    const buffer = await reportService.renderReportAsXlsx(report);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${courseId}.xlsx"`);
    return res.send(buffer);
  }

  return res.json(report);
});

module.exports = { courseReport };
