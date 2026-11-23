import unittest

from dedupe_staff_names import dedupe_infobox, dedupe_value


class DedupeStaffNamesTest(unittest.TestCase):
    def test_removes_later_plain_duplicates(self):
        self.assertEqual(dedupe_value('张三、李四、张三、张三'), '张三、李四')
        self.assertEqual(dedupe_value('张三、 李四 、 张三 '), '张三、 李四 、 张三 ')
        self.assertEqual(dedupe_value(' 张三 、李四、 张三 '), ' 张三 、李四')

    def test_keeps_annotated_and_non_name_parts(self):
        value = '张三、张三（本名）、张三[别名]、张三(注)、张三、A/B、A/B、DR MOVIE、DR MOVIE、张三；助手：李四、张三、张三'
        self.assertEqual(dedupe_value(value),
                         '张三、张三（本名）、张三[别名]、张三(注)、A/B、A/B、DR MOVIE、DR MOVIE；助手：李四、张三')

    def test_annotated_entries_do_not_count_as_duplicates(self):
        self.assertEqual(dedupe_value('张三（甲）、张三（甲）、张三[别名]、张三[别名]、张三、张三'),
                         '张三（甲）、张三（甲）、张三[别名]、张三[别名]、张三')

    def test_changes_only_anime_position_lines_and_preserves_other_text(self):
        infobox = '{{Infobox\r\n|企画= 张三、李四、张三\r\n|别名= 张三、张三\r\n|导演= 王五、王五（监督）、王五\r\n}}'
        self.assertEqual(
            dedupe_infobox(infobox, {'企画', '导演'}),
            '{{Infobox\r\n|企画= 张三、李四\r\n|别名= 张三、张三\r\n|导演= 王五、王五（监督）\r\n}}',
        )

    def test_no_change(self):
        self.assertIsNone(dedupe_infobox('|企画=张三、张三（別名）\n', {'企画'}))


if __name__ == '__main__':
    unittest.main()
