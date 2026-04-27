const { buscarSemanticamente } = require('./src/repositories/vectorRepository');
(async () => {
    try {
        const res = await buscarSemanticamente('vision', 1);
        console.log(JSON.stringify(res, null, 2));
    } catch(e) {
        console.error(e);
    }
})();
