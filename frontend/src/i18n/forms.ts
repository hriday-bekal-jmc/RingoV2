const forms = {
  ja: {
    form_loading:          'フォームを読み込み中...',
    form_load_error:       'フォームの読み込みに失敗しました。ページをリロードしてください。',
    field_name:            '氏名',
    draft_hint:            '※ 下書きは後で編集・提出できます',
  },
  en: {
    form_loading:          'Loading form...',
    form_load_error:       'Failed to load form. Please reload the page.',
    field_name:            'Full Name',
    draft_hint:            '※ Drafts can be edited and submitted later',
  },
} as const;

export default forms;
