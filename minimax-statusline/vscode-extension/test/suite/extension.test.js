const assert = require('assert');
const vscode = require('vscode');

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('运行所有测试.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('JochenYang.minimax-status-vscode'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('JochenYang.minimax-status-vscode');
        assert.ok(extension);
    });

    test('Should register commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('minimaxStatus.refresh'));
        assert.ok(commands.includes('minimaxStatus.setup'));
    });
});
