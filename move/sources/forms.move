module tuskd::forms {
    use std::string::String;
    use std::vector;
    use sui::event;

    const E_NOT_OWNER: u64 = 1;

    public struct Form has key {
        id: object::UID,
        owner: address,
        title: String,
        description: String,
        schema_blob_id: String,
        admins: vector<address>,
        submission_count: u64,
    }

    public struct SubmissionEvent has copy, drop {
        form_id: object::ID,
        submission_id: u64,
        submitter: address,
        submission_blob_id: String,
        media_blob_ids: vector<String>,
    }

    public struct FormUpdatedEvent has copy, drop {
        form_id: object::ID,
        owner: address,
        title: String,
        description: String,
        schema_blob_id: String,
    }

    public struct FormAccessEvent has copy, drop {
        form_id: object::ID,
        owner: address,
        admins: vector<address>,
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
        admins: vector<address>,
        ctx: &mut TxContext,
    ) {
        let form = Form {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            title,
            description,
            schema_blob_id,
            admins,
            submission_count: 0,
        };

        event::emit(FormAccessEvent {
            form_id: object::id(&form),
            owner: tx_context::sender(ctx),
            admins,
        });

        transfer::share_object(form);
    }

    entry fun update_form(
        form: &mut Form,
        title: String,
        description: String,
        schema_blob_id: String,
        admins: vector<address>,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(is_owner_or_admin(form, sender), E_NOT_OWNER);

        form.title = title;
        form.description = description;
        form.schema_blob_id = schema_blob_id;
        form.admins = admins;

        event::emit(FormUpdatedEvent {
            form_id: object::id(form),
            owner: sender,
            title,
            description,
            schema_blob_id,
        });

        event::emit(FormAccessEvent {
            form_id: object::id(form),
            owner: form.owner,
            admins,
        });
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
        assert!(is_owner_or_admin(form, tx_context::sender(ctx)), E_NOT_OWNER);
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

    public fun admins(form: &Form): &vector<address> {
        &form.admins
    }

    public fun submission_count(form: &Form): u64 {
        form.submission_count
    }

    fun is_owner_or_admin(form: &Form, sender: address): bool {
        form.owner == sender || vector::contains(&form.admins, &sender)
    }
}
