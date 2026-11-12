/**
 * Home Dashboard — calendar feed.
 * Reads every calendar on your Google account (your own, shared, subscribed, holidays)
 * and returns the next ~2 weeks of events as JSON for the wall dashboard.
 *
 * Setup: script.google.com → New project → paste this → Deploy → New deployment →
 *        type "Web app", Execute as "Me", Who has access "Anyone" → Deploy → copy the /exec URL.
 */
function doGet(e) {
  var days = Math.min(Number((e && e.parameter && e.parameter.days) || 16), 60);
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start.getTime() + days * 86400000);
  var out = { calendars: [], events: [], tz: tz, generated: now.toISOString() };

  CalendarApp.getAllCalendars().forEach(function (c) {
    var id = c.getId();
    out.calendars.push({
      id: id, name: c.getName(), color: c.getColor(),
      primary: c.isMyPrimaryCalendar(), selected: c.isSelected(), hidden: c.isHidden()
    });
    var evs = [];
    try { evs = c.getEvents(start, end); } catch (err) { return; }
    evs.forEach(function (ev) {
      var allDay = ev.isAllDayEvent();
      out.events.push({
        cal: id,
        title: ev.getTitle() || '(busy)',
        allDay: allDay,
        start: allDay ? Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd') : ev.getStartTime().toISOString(),
        end: allDay ? Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd') : ev.getEndTime().toISOString(),
        location: ev.getLocation() || ''
      });
    });
  });

  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
