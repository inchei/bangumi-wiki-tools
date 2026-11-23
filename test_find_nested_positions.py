import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from find_nested_positions import count_positions, find_nested_positions, load_positions


class FindNestedPositionsTest(unittest.TestCase):
    def test_multiple_positions_in_one_field(self):
        infobox = '{{Infobox\r\n|企画= 张三；企画协力：李四；助手:王五\r\n|导演= 赵六\r\n}}'
        self.assertEqual(
            list(find_nested_positions(infobox)),
            [
                ('企画', '企画协力', '李四', '张三；企画协力：李四；助手:王五'),
                ('企画', '助手', '王五', '张三；企画协力：李四；助手:王五'),
            ],
        )

    def test_ignores_non_extracted_patterns(self):
        infobox = '|企画=张三；企画：李四；未填： ；网址=http://example.org\n|别名={\n[别名；职位：张三]\n}'
        self.assertEqual(list(find_nested_positions(infobox)), [])

    def test_counts_anime_staff_fields_only(self):
        subjects = [
            {'id': 1, 'type': 2, 'infobox': '|企画=张三；企画协力：李四；助手:王五\n|别名=张三；企画协力：李四'},
            {'id': 1, 'type': 2, 'infobox': '|企画=张三；企画协力：李四'},
            {'id': 2, 'type': 2, 'infobox': '|企画=赵六；企画协力：钱七'},
            {'id': 3, 'type': 4, 'infobox': '|企画=赵六；企画协力：钱七'},
        ]
        counts = count_positions(subjects, {'企画', '企画协力'})
        self.assertEqual(counts[('企画', '企画协力', True)], 3)
        self.assertEqual(counts[('企画', '助手', False)], 1)
        self.assertEqual(len(counts), 2)

    def test_loads_generated_anime_positions(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'staff_data.go'
            path.write_text('var animeStaffPositions = map[int]string{\n  35: "企画",\n  127: "企画协力",\n}\n'
                            'var gameStaffPositions = map[int]string{\n  1001: "助手",\n}\n')
            self.assertEqual(load_positions(path), {'企画', '企画协力'})


if __name__ == '__main__':
    unittest.main()
