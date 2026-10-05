// Danh sách tiện ích. Thêm tiện ích mới: tạo file trong thư mục này rồi thêm vào mảng dưới.
//
// Mỗi tiện ích là { id, name, icon, mount(rootEl, ctx) => cleanup? }
//   ctx.store  — kho bản ghi đã mã hoá + đồng bộ: list(type), get(id), put(id, value), remove(id), on(fn)
//   ctx.files  — file đính kèm đã mã hoá: upload(file), url(att), download(att), remove(id)
//   ctx.api    — gọi API server (đã kèm token)
// Dùng một `type` riêng cho bản ghi của tiện ích (vd 'habit', 'expense'); server không cần sửa gì.

import notes from './notes.js';
import settings from './settings.js';

export const tools = [notes, settings];
