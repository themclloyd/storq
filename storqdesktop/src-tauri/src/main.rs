// Release builds must not open a console window behind the till.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    storq_desktop_lib::run()
}
