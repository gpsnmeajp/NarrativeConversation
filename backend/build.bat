@echo off
cd %~dp0%
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
pyinstaller narrative_conversation.spec
pause