from unittest.mock import mock_open, patch

# from aggregator.config._config import load_config


class TestLoadConfig:
    @patch("builtins.open", new_callable=mock_open, read_data="")
    def test_load(self, mock_file):
        with open("/etc/secrets/fooooo.json") as fin:
            _ = fin.read()
        # _ = load_config()
