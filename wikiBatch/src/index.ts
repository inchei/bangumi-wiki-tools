import { createStaticDOM } from './dom';
import { initMorphIcons } from './morph';
import { injectStyles } from './styles';
import { isScriptTarget, registerScriptMenuCommand } from './utils';

registerScriptMenuCommand();

if (isScriptTarget()) {
    injectStyles();
    initMorphIcons();
    createStaticDOM();
}
