module tusktable::forms {
    use std::string::String;
    use sui::event;

    const E_NOT_OWNER: u64 = 1;

    public struct Form has key {
        id: object::UID,
        owner: address,
        title: String,
        description: String,
        schema_blob_id: String,
        submission_count: u64,
    }

    public struct SubmissionEvent has copy, drop {
        form_id: object::ID,
        submission_id: u64,
        submitter: address,
        submission_blob_id: String,
        media_blob_ids: vector<String>,
    }

    public struct StatusEvent has copy, drop {
        form_id: object::ID,
        submission_id: u64,
        status: u8,
        priority: u8,
    }

    entry fun create_form(
        title: String,
        description: String,
        schema_blob_id: String,
        ctx: &mut TxContext,
    ) {
        let form = Form {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            title,
            description,
            schema_blob_id,
            submission_count: 0,
        };

        transfer::share_object(form);
    }

    entry fun submit(
        form: &mut Form,
        submission_blob_id: String,
        media_blob_ids: vector<String>,
        ctx: &TxContext,
    ) {
        form.submission_count = form.submission_count + 1;
        event::emit(SubmissionEvent {
            form_id: object::id(form),
            submission_id: form.submission_count,
            submitter: tx_context::sender(ctx),
            submission_blob_id,
            media_blob_ids,
        });
    }

    entry fun set_submission_status(
        form: &Form,
        submission_id: u64,
        status: u8,
        priority: u8,
        ctx: &TxContext,
    ) {
        assert!(form.owner == tx_context::sender(ctx), E_NOT_OWNER);
        event::emit(StatusEvent {
            form_id: object::id(form),
            submission_id,
            status,
            priority,
        });
    }

    public fun owner(form: &Form): address {
        form.owner
    }

    public fun schema_blob_id(form: &Form): &String {
        &form.schema_blob_id
    }

    public fun submission_count(form: &Form): u64 {
        form.submission_count
    }
}
