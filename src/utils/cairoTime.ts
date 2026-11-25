// Business time is Cairo (Africa/Cairo) whatever the server's own time zone is (live may run in UTC).

/** Cairo local date ("YYYY-MM-DD"), time ("HH:MM:SS") and a Date built from them. */
export const cairoNow = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Cairo",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    const hour = p.hour === "24" ? "00" : p.hour;
    return {
        today: `${p.year}-${p.month}-${p.day}`,
        currentTime: `${hour}:${p.minute}:${p.second}`,
        /** "YYYY-MM-DD HH:MM:SS" in Cairo — compare with CONCAT(session day, ' ', time) in SQL */
        stamp: `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`,
        cairoDate: new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`),
    };
};
