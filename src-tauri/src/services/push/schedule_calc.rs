//! 定时推送的"下次运行时刻"计算
//!
//! 给定触发时分（"HH:MM"）+ 循环规则（daily / weekly），算出**严格晚于** `from`
//! 的下一个触发时刻，格式 'YYYY-MM-DD HH:MM:SS'（本地时间）。
//!
//! 调度器在三处用它：建推送时算首个 next_run_at、每次跑完推进 next_run_at、启用时重算。
//! 用"严格晚于 from"避免刚跑完又立刻命中同一时刻导致重复推送。

use chrono::{Datelike, Duration, NaiveDateTime};

/// 解析 "HH:MM" 或 "HH:MM:SS" → (时, 分)
fn parse_hm(s: &str) -> Option<(u32, u32)> {
    let mut it = s.trim().split(':');
    let h: u32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    if h < 24 && m < 60 {
        Some((h, m))
    } else {
        None
    }
}

/// 解析 weekly 的周几集合（ISO 1=Mon..7=Sun）。None / 空 / 解析全失败 → 视为"每天"（全 7 天）。
fn parse_weekdays(spec: Option<&str>) -> Vec<u32> {
    let all: Vec<u32> = (1..=7).collect();
    match spec {
        None => all,
        Some(s) => {
            let set: Vec<u32> = s
                .split(',')
                .filter_map(|x| x.trim().parse::<u32>().ok())
                .filter(|d| (1..=7).contains(d))
                .collect();
            if set.is_empty() {
                all
            } else {
                set
            }
        }
    }
}

/// 计算严格晚于 `from` 的下一个触发时刻。无法解析 schedule_time 时返回 None。
pub fn compute_next_run(
    schedule_time: &str,
    repeat_kind: &str,
    repeat_weekdays: Option<&str>,
    from: NaiveDateTime,
) -> Option<String> {
    let (h, m) = parse_hm(schedule_time)?;
    let weekly = repeat_kind == "weekly";
    let weekdays = parse_weekdays(repeat_weekdays);

    // 从今天起向后最多看 8 天，找到第一个满足"时刻 > from 且（daily 或 命中周几）"的日子
    for offset in 0..=8 {
        let date = from.date() + Duration::days(offset);
        let candidate = date.and_hms_opt(h, m, 0)?;
        if candidate <= from {
            continue;
        }
        if weekly {
            // ISO：周一=1 .. 周日=7
            let wd = date.weekday().number_from_monday();
            if !weekdays.contains(&wd) {
                continue;
            }
        }
        return Some(candidate.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn dt(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap()
    }

    #[test]
    fn daily_today_not_passed_yet() {
        // 现在 07:00，定 08:00 → 今天 08:00
        let from = dt(2026, 5, 29, 7, 0);
        let next = compute_next_run("08:00", "daily", None, from).unwrap();
        assert_eq!(next, "2026-05-29 08:00:00");
    }

    #[test]
    fn daily_today_already_passed() {
        // 现在 09:00，定 08:00 → 明天 08:00
        let from = dt(2026, 5, 29, 9, 0);
        let next = compute_next_run("08:00", "daily", None, from).unwrap();
        assert_eq!(next, "2026-05-30 08:00:00");
    }

    #[test]
    fn daily_exactly_at_time_rolls_to_tomorrow() {
        // 恰好命中触发点（刚跑完）→ 严格晚于，滚到明天
        let from = dt(2026, 5, 29, 8, 0);
        let next = compute_next_run("08:00", "daily", None, from).unwrap();
        assert_eq!(next, "2026-05-30 08:00:00");
    }

    #[test]
    fn weekly_picks_next_listed_weekday() {
        // 2026-05-29 是周五(5)。只选周一(1) → 下周一 2026-06-01
        let from = dt(2026, 5, 29, 10, 0);
        let next = compute_next_run("08:00", "weekly", Some("1"), from).unwrap();
        assert_eq!(next, "2026-06-01 08:00:00");
    }

    #[test]
    fn weekly_today_is_listed_and_time_not_passed() {
        // 周五(5) 07:00，选周五 → 今天 08:00
        let from = dt(2026, 5, 29, 7, 0);
        let next = compute_next_run("08:00", "weekly", Some("5"), from).unwrap();
        assert_eq!(next, "2026-05-29 08:00:00");
    }

    #[test]
    fn weekly_empty_weekdays_behaves_like_daily() {
        let from = dt(2026, 5, 29, 9, 0);
        let next = compute_next_run("08:00", "weekly", Some(""), from).unwrap();
        assert_eq!(next, "2026-05-30 08:00:00");
    }

    #[test]
    fn invalid_time_returns_none() {
        let from = dt(2026, 5, 29, 9, 0);
        assert!(compute_next_run("99:99", "daily", None, from).is_none());
        assert!(compute_next_run("abc", "daily", None, from).is_none());
    }
}
