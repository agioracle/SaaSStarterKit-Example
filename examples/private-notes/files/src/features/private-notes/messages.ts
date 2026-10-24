/** Recipe-local bilingual dictionary. Promote keys to messages/*.json when adopting your product. */
export const noteMessages = {
  en: {
    title: 'Private notes', intro: 'Only you can read these notes. Pinning requires an active paid plan.',
    titleLabel: 'Title', bodyLabel: 'Note', create: 'Save note', empty: 'No notes yet',
    emptyBody: 'Save your first private note above.', loading: 'Loading notes…', retry: 'Try again',
    remove: 'Delete', confirmDelete: 'Delete this note?', pin: 'Pin (paid)', unpin: 'Unpin',
    saved: 'Note saved.', deleted: 'Note deleted.', updated: 'Note updated.',
    back: 'Dashboard', limit: 'Up to 100 notes, 120 title characters and 4,000 note characters.',
  },
  zh: {
    title: '私人笔记', intro: '只有你能读取这些笔记。置顶需要有效的付费套餐。',
    titleLabel: '标题', bodyLabel: '正文', create: '保存笔记', empty: '还没有笔记',
    emptyBody: '在上方保存第一条私人笔记。', loading: '正在读取笔记…', retry: '重试',
    remove: '删除', confirmDelete: '确认删除这条笔记？', pin: '置顶（付费）', unpin: '取消置顶',
    saved: '笔记已保存。', deleted: '笔记已删除。', updated: '笔记已更新。',
    back: '控制台', limit: '最多 100 条笔记，标题最多 120 字，正文最多 4,000 字。',
  },
} as const;
